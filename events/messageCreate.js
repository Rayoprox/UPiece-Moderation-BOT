const { Events } = require('discord.js');
const db = require('../utils/db.js');
const { resolveArgument, PrefixInteraction } = require('../utils/prefixShim.js');
const { error } = require('../utils/embedFactory.js');
const guildCache = require('../utils/guildCache.js');
const ms = require('ms'); 

const { validateCommandPermissions, sendCommandLog } = require('../utils/logicHelper.js');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot || !message.guild) return;

        if (process.env.DISCORD_GUILD_ID && message.guild.id !== process.env.DISCORD_GUILD_ID) return;

        const { guild, author, member } = message;

        let guildData = guildCache.get(guild.id);
      
        if (!guildData || !guildData.settings || guildData.settings.staff_roles === undefined) {
            const [settingsRes, permsRes] = await Promise.all([
                db.query('SELECT * FROM guild_settings WHERE guildid = $1', [guild.id]),
                db.query('SELECT command_name, role_id FROM command_permissions WHERE guildid = $1', [guild.id])
            ]);

            guildData = { 
                settings: settingsRes.rows[0] || { prefix: '!' }, 
                permissions: permsRes.rows || [] 
            };
            
            
            guildCache.set(guild.id, guildData);
        }
      

        const SERVER_PREFIX = guildData.settings.prefix || '!';

        if (!message.content.startsWith(SERVER_PREFIX)) return;
        
        const args = message.content.slice(SERVER_PREFIX.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        const command = message.client.commands.get(commandName);

        if (!command) return;

        const result = await validateCommandPermissions(
            message.client, 
            guild, 
            member, 
            author, 
            commandName, 
            db
        );

        if (!result.valid) {
            return message.reply({ embeds: [error(result.reason)] });
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
                     return message.reply({ embeds: [error(`Invalid subcommand. Available: ${definedOptions.map(o => o.name).join(', ')}`)] });
                }
            }
        }
        
        let argIndex = 0;

        for (const optionDef of definedOptions) {
            if (argIndex >= args.length) {
                if (optionDef.required) {
                    return message.reply({ embeds: [error(`Missing required argument: **${optionDef.name}**`)] });
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
                         return message.reply({ embeds: [error(`Invalid duration format for **${optionDef.name}**. Expected format like 10m, 1h or 'off'.`)] });
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
                     return message.reply({ embeds: [error(`Invalid argument for **${optionDef.name}**. Expected: ${optionDef.description}`)] });
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
            message.reply({ embeds: [error("An error occurred while executing this command.")] }).catch(()=>{});
        }
    },
};