const { Events, PermissionsBitField, MessageFlags, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType } = require('discord.js');
const ms = require('ms');
const { emojis } = require('../utils/config.js');
const antiNuke = require('../utils/antiNuke.js'); // Importación directa para evitar errores de require inline

const MAIN_GUILD_ID = process.env.DISCORD_GUILD_ID;
const APPEAL_GUILD_ID = process.env.DISCORD_APPEAL_GUILD_ID;
const DISCORD_MAIN_INVITE = process.env.DISCORD_MAIN_INVITE;

async function safeDefer(interaction, isUpdate = false, isEphemeral = false) {
    try {
        if (interaction.deferred || interaction.replied) return true;
        if (isUpdate) {
            await interaction.deferUpdate();
        } else {
            const options = isEphemeral ? { flags: [MessageFlags.Ephemeral] } : {};
            await interaction.deferReply(options);
        }
        return true;
    } catch (error) {
        if (error.code === 10062 || error.code === 40060) {
            return false; // Interacción ya manejada o expirada
        }
        return false;
    }
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction) return;

        const db = interaction.client.db;
        const guildId = interaction.guild?.id;

        // Helper para regenerar el panel de Setup
        const setupCommand = interaction.client.commands.get('setup');
        const generateSetupContent = setupCommand?.generateSetupContent;
        const logsPerPage = 5;

        // --- HELPER DE LOGS ---
        const generateLogEmbed = (logs, targetUser, page, totalPages, authorId, isWarningLog = false) => {
            const start = page * logsPerPage;
            const currentLogs = logs.slice(start, start + logsPerPage);
            const description = currentLogs.map(log => {
                const timestamp = Math.floor(Number(log.timestamp) / 1000);
                const action = log.action.charAt(0).toUpperCase() + log.action.slice(1).toLowerCase();
                const isRemoved = log.status === 'REMOVED' || log.status === 'VOIDED';
                const text = `**${action}** - <t:${timestamp}:f> (\`${log.caseid}\`)\n**Moderator:** ${log.moderatortag}\n**Reason:** ${log.reason}`;
                return isRemoved ? `~~${text}~~` : text;
            }).join('\n\n') || "No logs found for this page.";

            const embed = new EmbedBuilder()
                .setColor(isWarningLog ? 0xFFA500 : 0x3498DB)
                .setTitle(`${isWarningLog ? emojis.warn : emojis.info} ${isWarningLog ? 'Warnings' : 'Moderation Logs'} for ${targetUser.tag}`)
                .setDescription(description)
                .setFooter({ text: `Page ${page + 1} of ${totalPages} | Total Logs: ${logs.length}` });
            
            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`${isWarningLog ? 'warns' : 'modlogs'}_prev_${targetUser.id}_${authorId}`).setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
                new ButtonBuilder().setCustomId(`${isWarningLog ? 'warns' : 'modlogs'}_next_${targetUser.id}_${authorId}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
                new ButtonBuilder().setCustomId(`modlogs_purge-prompt_${targetUser.id}_${authorId}`).setLabel('Purge All Modlogs').setStyle(ButtonStyle.Danger).setDisabled(isWarningLog)
            );
            return { embed, components: [buttons] };
        };

        // --- MANEJO DE COMANDOS DE CHAT ---
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) return;

            // Diferir respuesta (Setup tiene su propio defer interno, lo ignoramos aquí si es setup)
            if (interaction.commandName !== 'setup') {
                const isPublic = command.isPublic ?? false;
                if (!await safeDefer(interaction, false, !isPublic)) return;
            }

            try {
                // Verificación de Permisos
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    const allowedRolesResult = await db.query('SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = $2', [guildId, command.data.name]);
                    const allowedRoles = allowedRolesResult.rows.map(r => r.role_id);
                    let isAllowed = allowedRoles.length > 0 ? interaction.member.roles.cache.hasAny(...allowedRoles) : true;
                    if (!isAllowed && command.data.default_member_permissions) isAllowed = interaction.member.permissions.has(command.data.default_member_permissions);
                    
                    if (!isAllowed) return interaction.editReply({ content: 'You do not have permission to use this command.' });
                }

                await command.execute(interaction);

                // Log de Comando
                const cmdLogRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'cmdlog'", [guildId]);
                if (cmdLogRes.rows.length > 0) {
                    const channel = interaction.guild.channels.cache.get(cmdLogRes.rows[0].channel_id);
                    if (channel) {
                        const logEmbed = new EmbedBuilder()
                            .setColor(0x3498DB)
                            .setTitle('Command Executed')
                            .setDescription(`**User:** ${interaction.user.tag}\n**Command:** \`/${interaction.commandName}\`\n**Channel:** <#${interaction.channel.id}>`)
                            .setTimestamp();
                        channel.send({ embeds: [logEmbed] }).catch(() => {});
                    }
                }
            } catch (error) {
                console.error(error);
                if (interaction.deferred || interaction.replied) await interaction.editReply({ content: 'Error executing command.' }).catch(() => {});
            }
            return;
        }

        // --- MANEJO DE BOTONES Y MENÚS ---
        if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
            const { customId, values } = interaction;
            const parts = customId.split('_');

            // Seguridad para botones de logs
            if (customId.startsWith('modlogs_') || customId.startsWith('warns_')) {
                 const logsAuthorId = parts[parts.length - 1]; 
                 if (parts.length >= 4 && interaction.user.id !== logsAuthorId) {
                     return interaction.reply({ content: `${emojis.error} Only the command author can use these buttons.`, flags: [MessageFlags.Ephemeral] });
                 }
            }

            // ==========================================
            //       CONFIGURACIÓN ANTI-NUKE
            // ==========================================
            if (customId === 'setup_antinuke') {
                if (!await safeDefer(interaction, true)) return;
                
                const settingsRes = await db.query('SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1', [guildId]);
                const isEnabled = settingsRes.rows.length > 0 && settingsRes.rows[0].antinuke_enabled;

                const embed = new EmbedBuilder()
                    .setTitle('☢️ Anti-Nuke Configuration')
                    .setDescription(`Status: **${isEnabled ? 'ENABLED ✅' : 'DISABLED ❌'}**\n\nProtects against mass deletion of channels/roles. Bans offenders and restores data from 24h backup.`)
                    .setColor(isEnabled ? 0x2ECC71 : 0xE74C3C);

                const toggleBtn = new ButtonBuilder()
                    .setCustomId('antinuke_toggle')
                    .setLabel(isEnabled ? 'Disable Anti-Nuke' : 'Enable Anti-Nuke')
                    .setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success);
                
                const backBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary);

                const channelSelect = new ChannelSelectMenuBuilder()
                    .setCustomId('select_antinuke_channel')
                    .setPlaceholder('Select channel for "Nuke Triggered" alerts...')
                    .setChannelTypes(ChannelType.GuildText); 

                await interaction.editReply({ 
                    embeds: [embed], 
                    components: [
                        new ActionRowBuilder().addComponents(toggleBtn, backBtn),
                        new ActionRowBuilder().addComponents(channelSelect)
                    ] 
                });
                return;
            }

            if (customId === 'antinuke_toggle') {
                if (!await safeDefer(interaction, true)) return;
                const settingsRes = await db.query('SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1', [guildId]);
                const currentStatus = settingsRes.rows.length > 0 && settingsRes.rows[0].antinuke_enabled;
                const newStatus = !currentStatus;

                await db.query(`INSERT INTO guild_backups (guildid, antinuke_enabled, threshold_count, threshold_time) VALUES ($1, $2, 5, 10) ON CONFLICT (guildid) DO UPDATE SET antinuke_enabled = $2`, [guildId, newStatus]);

                if (newStatus) {
                    antiNuke.createBackup(interaction.guild);
                }

                if (generateSetupContent) {
                    const { embed, components } = await generateSetupContent(interaction, guildId);
                    await interaction.editReply({ content: `✅ Anti-Nuke system has been **${newStatus ? 'ENABLED' : 'DISABLED'}**.`, embeds: [embed], components });
                } else {
                    await interaction.editReply({ content: `✅ Anti-Nuke system has been **${newStatus ? 'ENABLED' : 'DISABLED'}**.` });
                }
                return;
            }
            
            if (customId === 'select_antinuke_channel') {
                if (!await safeDefer(interaction, true)) return;
                await db.query(`INSERT INTO log_channels (guildid, log_type, channel_id) VALUES ($1, $2, $3) ON CONFLICT(guildid, log_type) DO UPDATE SET channel_id = $3`, [guildId, 'antinuke', values[0]]);
                
                // Recargar vista Anti-Nuke
                const settingsRes = await db.query('SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1', [guildId]);
                const isEnabled = settingsRes.rows.length > 0 && settingsRes.rows[0].antinuke_enabled;

                const embed = new EmbedBuilder()
                    .setTitle('☢️ Anti-Nuke Configuration')
                    .setDescription(`Status: **${isEnabled ? 'ENABLED ✅' : 'DISABLED ❌'}**\n\nProtects against mass deletion of channels/roles.\n\n✅ **Alert Channel Updated!**`)
                    .setColor(isEnabled ? 0x2ECC71 : 0xE74C3C);

                const toggleBtn = new ButtonBuilder().setCustomId('antinuke_toggle').setLabel(isEnabled ? 'Disable' : 'Enable').setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success);
                const backBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary);
                const channelSelect = new ChannelSelectMenuBuilder().setCustomId('select_antinuke_channel').setPlaceholder('Select alert channel...').setChannelTypes(ChannelType.GuildText);

                await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(toggleBtn, backBtn), new ActionRowBuilder().addComponents(channelSelect)] });
                return;
            }


            // ==========================================
            //           AUTOMOD CONFIGURATION
            // ==========================================
            if (customId === 'automod_add_rule') {
                if (!await safeDefer(interaction, true)) return;
                const menu = new StringSelectMenuBuilder().setCustomId('automod_action_select').setPlaceholder('1. Select punishment type...').addOptions([{ label: 'Ban', value: 'BAN' },{ label: 'Mute', value: 'MUTE' },{ label: 'Kick', value: 'KICK' }]);
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🤖 Add Automod Rule').setDescription('Select the action.')], components: [new ActionRowBuilder().addComponents(menu)] });
                return;
            }
            if (customId === 'automod_action_select') {
                if (!await safeDefer(interaction, true)) return;
                const action = values[0];
                const opts = Array.from({length:10}, (_,i)=>({label:`${i+1} Warnings`, value:`${i+1}:${action}`}));
                const menu = new StringSelectMenuBuilder().setCustomId('automod_warn_select').setPlaceholder('2. Select warning count...').addOptions(opts);
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`Automod: When to ${action}?`)], components: [new ActionRowBuilder().addComponents(menu)] });
                return;
            }
            if (customId === 'automod_warn_select') {
                const [count, action] = values[0].split(':');
                if (action === 'KICK') {
                    if (!await safeDefer(interaction, true)) return;
                    await db.query(`INSERT INTO automod_rules (guildid, rule_order, warnings_count, action_type) VALUES ($1, (SELECT COALESCE(MAX(rule_order),0)+1 FROM automod_rules WHERE guildid=$1), $2, $3) ON CONFLICT(guildid, warnings_count) DO UPDATE SET action_type=$3`, [guildId, count, action]);
                    const { embed, components } = await generateSetupContent(interaction, guildId);
                    await interaction.editReply({ content: '✅ Rule Saved.', embeds: [embed], components });
                } else {
                    const modal = new ModalBuilder().setCustomId(`automod_duration_modal:${count}:${action}`).setTitle(`Duration for ${action}`);
                    const input = new TextInputBuilder().setCustomId('duration_value').setLabel('Duration (e.g. 1h, 0=Perm)').setStyle(TextInputStyle.Short).setRequired(true);
                    await interaction.showModal(modal.addComponents(new ActionRowBuilder().addComponents(input)));
                }
                return;
            }
            if (customId.startsWith('automod_duration_modal:')) {
                if (!await safeDefer(interaction, false, true)) return;
                const [, count, action] = customId.split(':');
                const val = interaction.fields.getTextInputValue('duration_value');
                const dur = val === '0' ? null : val;
                
                await db.query(`INSERT INTO automod_rules (guildid, rule_order, warnings_count, action_type, action_duration) VALUES ($1, (SELECT COALESCE(MAX(rule_order),0)+1 FROM automod_rules WHERE guildid=$1), $2, $3, $4) ON CONFLICT(guildid, warnings_count) DO UPDATE SET action_type=$3, action_duration=$4`, [guildId, count, action, dur]);
                
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ content: '✅ Rule Saved.', embeds: [embed], components });
                return;
            }
            if (customId === 'automod_remove_rule') {
                if (!await safeDefer(interaction, false, true)) return;
                const rules = await db.query('SELECT rule_order, warnings_count, action_type FROM automod_rules WHERE guildid = $1 ORDER BY rule_order', [guildId]);
                if (rules.rows.length === 0) return interaction.editReply('No rules to remove.');
                const menu = new StringSelectMenuBuilder().setCustomId('automod_select_remove').setPlaceholder('Select rule...').addOptions(rules.rows.map(r => ({ label: `Rule #${r.rule_order}: ${r.warnings_count} warns -> ${r.action_type}`, value: r.rule_order.toString() })));
                await interaction.editReply({ content: 'Select rule to delete:', components: [new ActionRowBuilder().addComponents(menu)] });
                return;
            }
            if (customId === 'automod_select_remove') {
                if (!await safeDefer(interaction, true)) return;
                await db.query('DELETE FROM automod_rules WHERE guildid=$1 AND rule_order=$2', [guildId, values[0]]);
                // Reordenar
                const remaining = await db.query('SELECT id FROM automod_rules WHERE guildid=$1 ORDER BY warnings_count', [guildId]);
                for(let i=0; i<remaining.rows.length; i++) await db.query('UPDATE automod_rules SET rule_order=$1 WHERE id=$2', [i+1, remaining.rows[i].id]);
                
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ content: '✅ Rule deleted.', embeds: [embed], components });
                return;
            }

            // ==========================================
            //           LOGS & APPEALS (CORE)
            // ==========================================
            if (customId.startsWith('modlogs_') || customId.startsWith('warns_')) {
                 const [prefix, action, userId, authorId] = parts;
                 
                 if (action === 'next' || action === 'prev') {
                    if (!await safeDefer(interaction, true)) return;
                    const isWarn = prefix === 'warns';
                    const logs = (await db.query(`SELECT * FROM modlogs WHERE userid=$1 AND guildid=$2 ${isWarn?"AND action='WARN'":""} ORDER BY timestamp DESC`, [userId, guildId])).rows;
                    const targetUser = await interaction.client.users.fetch(userId);
                    let page = parseInt(interaction.message.embeds[0].footer.text.split(' ')[1], 10) - 1;
                    page += (action === 'next' ? 1 : -1);
                    const data = generateLogEmbed(logs, targetUser, page, Math.ceil(logs.length/logsPerPage), authorId, isWarn);
                    await interaction.editReply(data);
                    return;
                 }
                 if (action === 'purge-prompt') {
                     if (!await safeDefer(interaction, false, true)) return;
                     const row = new ActionRowBuilder().addComponents(
                         new ButtonBuilder().setCustomId(`modlogs_purge-confirm_${userId}_${authorId}`).setLabel('CONFIRM DELETE').setStyle(ButtonStyle.Danger),
                         new ButtonBuilder().setCustomId(`modlogs_purge-cancel_${userId}_${authorId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                     );
                     await interaction.editReply({ content: `⚠️ **WARNING:** Delete ALL logs for <@${userId}>?`, components: [row] });
                     return;
                 }
                 if (action === 'purge-confirm') {
                     if (!await safeDefer(interaction, true)) return;
                     await db.query("DELETE FROM modlogs WHERE userid=$1 AND guildid=$2", [userId, guildId]);
                     await interaction.editReply({ content: '✅ Logs Purged.', components: [] });
                     // Cmd Log
                     const cmdLogRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid=$1 AND log_type='cmdlog'", [guildId]);
                     if (cmdLogRes.rows.length > 0) {
                         const ch = interaction.guild.channels.cache.get(cmdLogRes.rows[0].channel_id);
                         if (ch) ch.send({ embeds: [new EmbedBuilder().setTitle('Logs Purged').setDescription(`Target: <@${userId}>\nExecutor: <@${interaction.user.id}>`).setColor(0xAA0000)] }).catch(()=>{});
                     }
                     return;
                 }
                 if (action === 'purge-cancel') {
                     if (!await safeDefer(interaction, true)) return;
                     await interaction.editReply({ content: 'Cancelled.', components: [] });
                     return;
                 }
            }
            
             
            if (customId.startsWith('warns_remove-start_')) {
                await interaction.deferReply({ ephemeral: true });
                const [, , userId, authorId] = parts;
                const activeWarningsResult = await db.query("SELECT caseid, reason FROM modlogs WHERE userid = $1 AND guildid = $2 AND action = 'WARN' AND status = 'ACTIVE' ORDER BY timestamp DESC", [userId, guildId]);
                if (activeWarningsResult.rows.length === 0) return interaction.editReply({ content: `${emojis.error} This user has no active warnings to remove.` });
                const options = activeWarningsResult.rows.map(w => ({ label: `Case ID: ${w.caseid}`, description: w.reason.substring(0, 50), value: w.caseid }));
                const menu = new StringSelectMenuBuilder().setCustomId(`warns_remove-select_${userId}_${authorId}`).setPlaceholder('Select a warning to annul...').addOptions(options);
                return interaction.editReply({ content: 'Please select an active warning to **annul** (mark as removed):', components: [new ActionRowBuilder().addComponents(menu)] });
            }

           if (customId.startsWith('warns_remove-select_')) {
                await interaction.deferUpdate();
                const caseIdToRemove = values[0];
                let editSuccess = false;
                try {
                    const logResult = await db.query('SELECT * FROM modlogs WHERE caseid = $1 AND guildid = $2', [caseIdToRemove, interaction.guild.id]);
                    const log = logResult.rows[0];
                    await db.query("UPDATE modlogs SET status = 'REMOVED' WHERE caseid = $1 AND guildid = $2", [caseIdToRemove, interaction.guild.id]);
                    if (log && log.logmessageid) {
                        try {
                            const modLogResult = await db.query("SELECT channel_id FROM log_channels WHERE log_type='modlog' AND guildid = $1", [interaction.guild.id]);
                            const modLogChannelId = modLogResult.rows[0]?.channel_id;
                            if (modLogChannelId) {
                                const channel = await interaction.client.channels.fetch(modLogChannelId);
                                const message = await channel.messages.fetch(log.logmessageid);
                                if (message && message.embeds.length > 0) {
                                    const originalEmbed = message.embeds[0];
                                    const newEmbed = EmbedBuilder.from(originalEmbed).setColor(0x95A5A6).setTitle(`${emojis.warn} Case Annulled: ${log.action.toUpperCase()}`).setFooter({ text: `Case ID: ${caseIdToRemove} | Status: REMOVED by ${interaction.user.tag}` });
                                    await message.edit({ embeds: [newEmbed] });
                                    editSuccess = true;
                                }
                            }
                        } catch (error) {
                            console.warn(`[WARN-REMOVE] Could not edit log message for Case ID ${caseIdToRemove}: ${error.message}`);
                        }
                    }
                    await interaction.editReply({ content: `${emojis.success} Warning \`${caseIdToRemove}\` has been successfully **annulled**. ${editSuccess ? 'The original log embed has been updated.' : ''}`, components: [] });
                } catch (dbError) {
                    console.error('[ERROR] Failed to annul warning:', dbError);
                    await interaction.editReply({ content: `${emojis.error} A database error occurred while trying to annul the warning.` });
                }
                return;
            }
           if (interaction.isChannelSelectMenu() && customId.endsWith('_channel') && !customId.includes('antinuke')) {
                if (!await safeDefer(interaction, true)) return;
                const type = customId.replace('select_', '').replace('_channel', '');
                await db.query(`INSERT INTO log_channels (guildid, log_type, channel_id) VALUES ($1, $2, $3) ON CONFLICT(guildid, log_type) DO UPDATE SET channel_id = $3`, [guildId, type, values[0]]);
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ embeds: [embed], components });
                return;
            }
            if (interaction.isRoleSelectMenu() && (customId === 'select_staff_roles' || customId.startsWith('perms_role_select_'))) {
                 if (!await safeDefer(interaction, true)) return;
                 if (customId === 'select_staff_roles') {
                     await db.query(`INSERT INTO guild_settings (guildid, staff_roles) VALUES ($1, $2) ON CONFLICT(guildid) DO UPDATE SET staff_roles = $2`, [guildId, values.join(',')]);
                 } else {
                     const cmd = customId.replace('perms_role_select_', '');
                     await db.query('DELETE FROM command_permissions WHERE guildid=$1 AND command_name=$2', [guildId, cmd]);
                     for (const rid of values) await db.query('INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, $2, $3)', [guildId, cmd, rid]);
                 }
                 const { embed, components } = await generateSetupContent(interaction, guildId);
                 await interaction.editReply({ content: '✅ Saved.', embeds: [embed], components });
                 return;
            }
            if (customId === 'select_command_perms') {
                if (!await safeDefer(interaction, true)) return;
                const cmd = values[0];
                const menu = new RoleSelectMenuBuilder().setCustomId(`perms_role_select_${cmd}`).setPlaceholder(`Select roles for /${cmd}`).setMinValues(0).setMaxValues(25);
                await interaction.editReply({ content: `Editing perms for /${cmd}`, components: [new ActionRowBuilder().addComponents(menu)] });
                return;
            }
        }
    },
};