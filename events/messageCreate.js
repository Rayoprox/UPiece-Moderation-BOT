const { Events, PermissionsBitField, EmbedBuilder } = require('discord.js');
const db = require('../utils/db.js');
const { resolveArgument, PrefixInteraction } = require('../utils/prefixShim.js');
const { error } = require('../utils/embedFactory.js');
const guildCache = require('../utils/guildCache.js');
const ms = require('ms'); 

const { validateCommandPermissions, sendCommandLog } = require('../utils/logicHelper.js');

const antiSpamState = new Map();

function scheduleCommandMessageDeletion(message, guildData) {
    if (guildData.settings?.delete_prefix_cmd_message) {
        setTimeout(() => {
            message.delete().catch(() => {});
        }, 500);
    }
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot || !message.guild) return;

        if (process.env.DISCORD_GUILD_ID && message.guild.id !== process.env.DISCORD_GUILD_ID) return;

        const { guild, author, member } = message;

        let guildData = guildCache.get(guild.id);
      
        if (!guildData || !guildData.settings) {
            let settingsRes, permsRes;
            try {
                // Intenta primero sin la columna que puede no existir
                [settingsRes, permsRes] = await Promise.all([
                    db.query('SELECT guildid, staff_roles, mod_immunity, universal_lock, prefix, log_channel_id FROM guild_settings WHERE guildid = $1', [guild.id]),
                    db.query('SELECT command_name, role_id FROM command_permissions WHERE guildid = $1', [guild.id])
                ]);
            } catch (e) {
                throw e;
            }

            guildData = { 
                settings: {
                    prefix: '!',
                    delete_prefix_cmd_message: false,
                    ...settingsRes.rows[0]
                },
                permissions: permsRes.rows || [] 
            };
            
            // Intenta obtener delete_prefix_cmd_message si existe (silent mode)
            try {
                const delRes = await db.query('SELECT delete_prefix_cmd_message FROM guild_settings WHERE guildid = $1', [guild.id], true);
                if (delRes.rows?.[0]?.delete_prefix_cmd_message !== undefined) {
                    guildData.settings.delete_prefix_cmd_message = delRes.rows[0].delete_prefix_cmd_message;
                }
            } catch (e) {
                // Column doesn't exist, use default
            }
            
            guildCache.set(guild.id, guildData);
        }

        const SERVER_PREFIX = guildData.settings.prefix || '!';

        try {
            const protRes = await db.query('SELECT * FROM automod_protections WHERE guildid = $1', [guild.id]);
            const prot = protRes.rows[0];
            if (prot) {
                const protectedRoles = prot.antimention_roles || [];
                const bypassRoles = prot.antimention_bypass || [];
                if (protectedRoles.length > 0 && message.mentions.members.size > 0) {
                    const mentionedMembers = Array.from(message.mentions.members.values());
                    const offending = mentionedMembers.find(m => m.roles.cache.hasAny(...protectedRoles));
                    if (offending) {
                        const senderHasBypass = member.permissions.has(PermissionsBitField.Flags.Administrator) || member.roles.cache.hasAny(...bypassRoles);
                        if (!senderHasBypass) {
                            const protectedRoleObjs = (protectedRoles || []).map(idOrName => {
                                let r = guild.roles.cache.get(idOrName);
                                if (!r) r = guild.roles.cache.find(x => x.name && x.name.toLowerCase() === String(idOrName).toLowerCase());
                                return r;
                            }).filter(Boolean);

                            const offendingRoleObjs = protectedRoleObjs.filter(r => offending.roles.cache.has(r.id));
                            let primaryRole = offendingRoleObjs.sort((a, b) => (b.position || 0) - (a.position || 0))[0];

                            if (!primaryRole) primaryRole = protectedRoleObjs.sort((a, b) => (b.position || 0) - (a.position || 0))[0];

                            const roleName = primaryRole ? primaryRole.name : 'that role';


                            const embed = new EmbedBuilder()
                                .setDescription(`Please do not mention ${roleName}. This server protects that role from direct mentions.`)
                                .setColor('#f43f5e')
                                .setFooter({ text: 'Repeated mentions may be moderated.' });

                            const sent = await message.reply({ embeds: [embed], allowedMentions: { parse: [], roles: [], repliedUser: false } }).catch(() => null);
                            if (sent) setTimeout(() => sent.delete().catch(() => {}), 5000);
                        }
                    }
                }

                if (prot.antispam) {
                    const antispam = prot.antispam;
                    const guildState = antiSpamState.get(guild.id) || new Map();
                    antiSpamState.set(guild.id, guildState);

                    if (antispam.mps && antispam.mps.threshold > 0) {
                        const thr = antispam.mps.threshold;
                        const bypass = (antispam.mps.bypass || []);
                        const senderBypass = member.permissions.has(PermissionsBitField.Flags.Administrator) || member.roles.cache.hasAny(...bypass);
                        if (!senderBypass) {
                            const userState = guildState.get(author.id) || [];
                            const now = Date.now();
                            userState.push(now);
                            const window = now - 1000;
                            const recent = userState.filter(t => t >= window);
                            guildState.set(author.id, recent);
                            if (recent.length > thr) {
                                const embed = new EmbedBuilder().setDescription('Please avoid spamming messages (messages/sec limit exceeded).').setColor('#f59e0b');
                                const sent = await message.channel.send({ embeds: [embed] }).catch(() => null);
                                if (sent) setTimeout(() => sent.delete().catch(() => {}), 3000);
                            }
                        }
                    }

                    if (antispam.repeated && antispam.repeated.threshold > 0) {
                        const thr = antispam.repeated.threshold;
                        const bypass = (antispam.repeated.bypass || []);
                        const senderBypass = member.permissions.has(PermissionsBitField.Flags.Administrator) || member.roles.cache.hasAny(...bypass);
                        if (!senderBypass) {
                            const regex = new RegExp(`(.)\\1{${thr - 1},}`);
                            if (regex.test(message.content)) {
                                const embed = new EmbedBuilder().setDescription('Please avoid repeated characters.').setColor('#f59e0b');
                                const sent = await message.channel.send({ embeds: [embed] }).catch(() => null);
                                if (sent) setTimeout(() => sent.delete().catch(() => {}), 3000);
                            }
                        }
                    }

                    if (antispam.emoji && antispam.emoji.threshold > 0) {
                        const thr = antispam.emoji.threshold;
                        const bypass = (antispam.emoji.bypass || []);
                        const senderBypass = member.permissions.has(PermissionsBitField.Flags.Administrator) || member.roles.cache.hasAny(...bypass);
                        if (!senderBypass) {
                            const customEmojiMatches = message.content.match(/<a?:\w+:\d+>/g) || [];
                            const unicodeEmojiMatches = message.content.match(/(\p{Extended_Pictographic})/gu) || [];
                            const totalEmojis = customEmojiMatches.length + unicodeEmojiMatches.length;
                            if (totalEmojis > thr) {
                                const embed = new EmbedBuilder().setDescription('Please avoid emoji spamming.').setColor('#f59e0b');
                                const sent = await message.channel.send({ embeds: [embed] }).catch(() => null);
                                if (sent) setTimeout(() => sent.delete().catch(() => {}), 3000);
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Automod check error:', e);
        }

        if (!message.content.startsWith(SERVER_PREFIX)) return;
        
        const args = message.content.slice(SERVER_PREFIX.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        const command = message.client.commands.get(commandName);

        if (!command) {
            const customRes = await db.query('SELECT response_json, allowed_roles FROM custom_commands WHERE guildid = $1 AND name = $2', [guild.id, commandName]);
            
            if (customRes.rows.length > 0) {
                const row = customRes.rows[0];
                const allowedRoles = row.allowed_roles ? JSON.parse(row.allowed_roles) : [];

                const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
                
                if (allowedRoles.length === 0) {
                    if (!isAdmin) return; 
                } else {
                    const hasRole = member.roles.cache.hasAny(...allowedRoles);
                    if (!hasRole && !isAdmin) return;
                }

                try {
                    await message.delete().catch(() => {});

                    const responseData = JSON.parse(row.response_json);
                    return message.channel.send(responseData);
                } catch (err) {
                    console.error("Error sending custom command:", err);
                }
            }
            return;
        }

        const result = await validateCommandPermissions(
            message.client, 
            guild, 
            member, 
            author, 
            commandName, 
            db
        );

        if (!result.valid) {
            message.channel.send({ embeds: [error(result.reason)] });
            scheduleCommandMessageDeletion(message, guildData);
            return;
        }

        const resolvedOptions = {};
        
        let definedOptions = command.data.options || [];
        let activeSubcommand = null;

        const hasSubcommands = definedOptions.some(opt => opt.constructor.name === 'SlashCommandSubcommandBuilder' || opt.type === 1);

        if (hasSubcommands) {
            const potentialSubName = args[0]?.toLowerCase();
            const subOption = definedOptions.find(opt => opt.name === potentialSubName && (opt.constructor.name === 'SlashCommandSubcommandBuilder' || opt.type === 1));

            if (subOption) {
                activeSubcommand = subOption.name;
                args.shift(); 
                definedOptions = subOption.options || []; 
            } else {
                if (args.length > 0) {
                     message.channel.send({ embeds: [error(`Invalid subcommand. Available: ${definedOptions.map(o => o.name).join(', ')}`)] });
                     scheduleCommandMessageDeletion(message, guildData);
                     return;
                }
            }
        }
        
        let argIndex = 0;

        for (const optionDef of definedOptions) {
            if (argIndex >= args.length) {
                if (optionDef.required) {
                    message.channel.send({ embeds: [error(`Missing required argument: **${optionDef.name}**`)] });
                    scheduleCommandMessageDeletion(message, guildData);
                    return;
                }
                break; 
            }

            let rawArg = args[argIndex];

            if (optionDef.name === 'duration') {
                const isTimeFormat = /^(\d+)(s|m|h|d|w|y|mo)?$/i.test(rawArg);
                const isOff = rawArg.toLowerCase() === 'off' || rawArg === '0';
                
                if (isTimeFormat || isOff) {
                    resolvedOptions[optionDef.name] = rawArg;
                    argIndex++;
                } else {
                    if (!optionDef.required) {
                        continue; 
                    } else {
                         message.channel.send({ embeds: [error(`Invalid duration format for **${optionDef.name}**. Expected format like 10m, 1h or 'off'.`)] });
                         scheduleCommandMessageDeletion(message, guildData);
                         return;
                    }
                }
            } 
            else if (optionDef.name === 'reason' || (optionDef.type === 3 && argIndex === args.length - 1)) {
                resolvedOptions[optionDef.name] = args.slice(argIndex).join(' ');
                argIndex = args.length; 
            } 
            else {
                const resolvedValue = await resolveArgument(message.guild, optionDef.type, rawArg);
                
                if (resolvedValue === null && optionDef.required) {
                     message.channel.send({ embeds: [error(`Invalid argument for **${optionDef.name}**. Expected: ${optionDef.description}`)] });
                     scheduleCommandMessageDeletion(message, guildData);
                     return;
                }
                
                if (resolvedValue !== null) {
                    resolvedOptions[optionDef.name] = resolvedValue;
                    argIndex++;
                } else if (!optionDef.required) {
                    continue; 
                } else {
                    argIndex++; 
                }
            }
        }

        try {
            const interactionShim = new PrefixInteraction(message, commandName, resolvedOptions, activeSubcommand);
            await command.execute(interactionShim);
            
            await sendCommandLog(interactionShim, db, result.isAdmin).catch(() => {});
        } catch (err) {
            console.error(`Error processing prefix command ${commandName}:`, err);
            message.channel.send({ embeds: [error("An error occurred while executing this command.")] }).catch(()=>{});
        }
        
        scheduleCommandMessageDeletion(message, guildData);
    },
};
