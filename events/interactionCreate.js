const { Events, PermissionsBitField, MessageFlags, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType } = require('discord.js');
const ms = require('ms');
const { emojis } = require('../utils/config.js');

const MAIN_GUILD_ID = process.env.DISCORD_GUILD_ID;
const APPEAL_GUILD_ID = process.env.DISCORD_APPEAL_GUILD_ID;
const DISCORD_MAIN_INVITE = process.env.DISCORD_MAIN_INVITE;

// --- 1. FUNCIONES DE UTILIDAD ---

async function smartReply(interaction, payload, ephemeral = false) {
    try {
        const options = typeof payload === 'string' ? { content: payload } : payload;
        if (ephemeral) options.flags = [MessageFlags.Ephemeral];

        if (interaction.replied || interaction.deferred) {
            if (interaction.replied) return await interaction.followUp(options);
            return await interaction.editReply(options);
        } else {
            return await interaction.reply(options);
        }
    } catch (error) {
        if (error.code === 10062 || error.code === 40060) return;
        console.error(`[SMART-REPLY ERROR]`, error);
    }
}

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
        if (error.code === 40060) return true; 
        if (error.code === 10062) return false;
        console.error(`[DEFER ERROR]`, error);
        return false;
    }
}

async function verifyAppealEligibility(userId, mainGuild, db) {
    const banEntry = await mainGuild.bans.fetch({ user: userId, force: true }).catch(() => null);
    if (!banEntry) {
        await db.query("DELETE FROM pending_appeals WHERE userid = $1 AND guildid = $2", [userId, mainGuild.id]);
        return { valid: false, message: `${emojis.error} You are not currently banned from **${mainGuild.name}**.` };
    }
    const blacklistResult = await db.query("SELECT * FROM appeal_blacklist WHERE userid = $1 AND guildid = $2", [userId, mainGuild.id]);
    if (blacklistResult.rows.length > 0) return { valid: false, message: `${emojis.error} You are **blacklisted** from the appeal system.` };

    const pendingResult = await db.query("SELECT appeal_messageid FROM pending_appeals WHERE userid = $1 AND guildid = $2", [userId, mainGuild.id]);
    if (pendingResult.rows.length > 0) {
        const chRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'banappeal'", [mainGuild.id]);
        if (chRes.rows.length > 0) {
            const channel = mainGuild.channels.cache.get(chRes.rows[0].channel_id);
            if (channel) {
                try {
                    await channel.messages.fetch(pendingResult.rows[0].appeal_messageid);
                    return { valid: false, message: `${emojis.error} You already have an active appeal pending review.` };
                } catch (e) {
                    await db.query("DELETE FROM pending_appeals WHERE userid = $1 AND guildid = $2", [userId, mainGuild.id]);
                }
            }
        }
    }
    const banLog = await db.query("SELECT endsat FROM modlogs WHERE userid = $1 AND guildid = $2 AND action = 'BAN' AND (status = 'ACTIVE' OR status = 'PERMANENT') ORDER BY timestamp DESC LIMIT 1", [userId, mainGuild.id]);
    if (banLog.rows[0]?.endsat) {
        const endsAtTimestamp = Math.floor(Number(banLog.rows[0].endsat) / 1000);
        return { valid: false, message: `${emojis.error} Temporary bans are not appealable. Expires: <t:${endsAtTimestamp}:f>.` };
    }
    return { valid: true };
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction) return;

        try {
            const db = interaction.client.db;
            const guildId = interaction.guild?.id;
            const setupCommand = interaction.client.commands.get('setup');
            const generateSetupContent = setupCommand?.generateSetupContent; 
            const logsPerPage = 5;

            // DEBUG LOG
            if (interaction.customId) console.log(`[INTERACTION] Button/Menu: ${interaction.customId} | User: ${interaction.user.tag}`);

            // --- HELPER LOGS ---
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

            // =========================================================================================
            //                                  COMANDOS DE CHAT
            // =========================================================================================
            if (interaction.isChatInputCommand()) {
                const command = interaction.client.commands.get(interaction.commandName);
                if (!command) return interaction.reply({ content: 'Error: Command not found.', ephemeral: true }).catch(() => {});
                
                const isPublic = command.isPublic ?? false;
                if (!await safeDefer(interaction, false, !isPublic)) return;

                try {
                    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                        const allowedRolesResult = await db.query('SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = $2', [interaction.guild.id, command.data.name]);
                        const allowedRoles = allowedRolesResult.rows.map(r => r.role_id);
                        let isAllowed = false;
                        if (allowedRoles.length > 0) isAllowed = interaction.member.roles.cache.some(role => allowedRoles.includes(role.id));
                        else if (command.data.default_member_permissions) isAllowed = interaction.member.permissions.has(command.data.default_member_permissions);
                        else isAllowed = true;
                        
                        if (!isAllowed) return interaction.editReply({ content: 'You do not have the required permissions for this command.' });
                    }
                } catch (dbError) {
                    console.error('[ERROR] Permission check failed:', dbError);
                    return interaction.editReply({ content: 'Database error checking permissions.' });
                }
               
                try {
                    await command.execute(interaction); 
                    const cmdLogResult = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [interaction.guild.id, 'cmdlog']);
                    if (cmdLogResult.rows[0]?.channel_id) {
                        const channel = interaction.guild.channels.cache.get(cmdLogResult.rows[0].channel_id);
                        if (channel) {
                            const fullCommand = `/${interaction.commandName}`;
                            const logEmbed = new EmbedBuilder().setColor(0x3498DB).setTitle('Command Executed').setDescription(`Executed by <@${interaction.user.id}> in <#${interaction.channel.id}>`).addFields({ name: 'User', value: `${interaction.user.tag} (${interaction.user.id})` }, { name: 'Command', value: `\`${fullCommand}\`` }).setTimestamp();
                            channel.send({ embeds: [logEmbed] }).catch(() => {}); 
                        }
                    }
                } catch (error) {
                    console.error(`[ERROR] /${interaction.commandName}:`, error);
                    await interaction.editReply({ content: `${emojis.error} An error occurred!` }).catch(() => {});
                }
                return; 
            }

            // =========================================================================================
            //                                  INTERACCIONES (BOTONES / MENUS)
            // =========================================================================================
            if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu() || interaction.isModalSubmit()) {
                const { customId, values } = interaction;
                const parts = customId.split('_');
                
                // Seguridad de Logs
                if (customId.startsWith('modlogs_') || customId.startsWith('warns_')) {
                     const logsAuthorId = parts[parts.length - 1];
                     if (interaction.user.id !== logsAuthorId) {
                         return interaction.reply({ content: `${emojis.error} Only the command author can use these buttons.`, flags: [MessageFlags.Ephemeral] });
                     }
                }

                // =====================================================================================
                //                           SETUP NAVIGATION
                // =====================================================================================
                
                if (customId === 'setup_channels') {
                    if (!await safeDefer(interaction, true)) return;
                    const modlog = new ChannelSelectMenuBuilder().setCustomId('select_modlog_channel').setPlaceholder('ModLog Channel').setChannelTypes([ChannelType.GuildText]);
                    const appeal = new ChannelSelectMenuBuilder().setCustomId('select_banappeal_channel').setPlaceholder('Ban Appeal Channel').setChannelTypes([ChannelType.GuildText]);
                    const cmdlog = new ChannelSelectMenuBuilder().setCustomId('select_cmdlog_channel').setPlaceholder('Cmd Log Channel').setChannelTypes([ChannelType.GuildText]);
                    // AÑADIDO: Selector para Anti-Nuke
                    const antinuke = new ChannelSelectMenuBuilder().setCustomId('select_antinuke_channel').setPlaceholder('Anti-Nuke Log Channel').setChannelTypes([ChannelType.GuildText]);
                    
                    const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                    
                    await interaction.editReply({
                        embeds: [new EmbedBuilder().setTitle('📜 Logging Channels').setDescription('Select channels for logs.')],
                        components: [
                            new ActionRowBuilder().addComponents(modlog),
                            new ActionRowBuilder().addComponents(appeal),
                            new ActionRowBuilder().addComponents(cmdlog),
                            new ActionRowBuilder().addComponents(antinuke),
                            backButton
                        ]
                    });
                    return;
                }

                if (customId === 'setup_staff_roles') {
                    if (!await safeDefer(interaction, true)) return;
                    const menu = new RoleSelectMenuBuilder().setCustomId('select_staff_roles').setPlaceholder('Select Staff Roles...').setMinValues(0).setMaxValues(25);
                    const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                    await interaction.editReply({
                        embeds: [new EmbedBuilder().setTitle('🛡️ Staff Roles').setDescription('Select roles that are considered Staff (immune to automod).')],
                        components: [new ActionRowBuilder().addComponents(menu), backButton]
                    });
                    return;
                }

                if (customId === 'setup_permissions') {
                    if (!await safeDefer(interaction, true)) return;
                    const commands = interaction.client.commands.map(c => ({ label: `/${c.data.name}`, value: c.data.name })).slice(0, 25);
                    const menu = new StringSelectMenuBuilder().setCustomId('select_command_perms').setPlaceholder('Select command...').addOptions(commands);
                    const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                    await interaction.editReply({
                        embeds: [new EmbedBuilder().setTitle('🔐 Permissions').setDescription('Select a command to edit its permissions.')],
                        components: [new ActionRowBuilder().addComponents(menu), backButton]
                    });
                    return;
                }

                if (customId === 'setup_back_to_main' && generateSetupContent) {
                     if (!await safeDefer(interaction, true)) return;
                     const { embed, components } = await generateSetupContent(interaction, guildId);
                     await interaction.editReply({ embeds: [embed], components });
                     return;
                }

                // Handler para el botón de Cancelar
                if (customId === 'cancel_setup') {
                    await interaction.deferUpdate(); 
                    await interaction.deleteReply().catch(() => {});
                    return;
                }

                // >>> HANDLER PARA ANTINUKE <<<
                if (customId === 'setup_antinuke') {
                    if (!await safeDefer(interaction, true)) return;
                    
                    // Leer de 'guild_backups'
                    const res = await db.query("SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1", [guildId]);
                    const isEnabled = res.rows[0]?.antinuke_enabled || false;

                    const embed = new EmbedBuilder()
                        .setTitle('🛡️ Anti-Nuke System')
                        .setDescription(`Status: **${isEnabled ? '✅ ENABLED' : '❌ DISABLED'}**\n\nProtect your server against mass deletions and bans.`)
                        .setColor(isEnabled ? 0x2ECC71 : 0xE74C3C);

                    const toggleBtn = new ButtonBuilder()
                        .setCustomId('antinuke_toggle')
                        .setLabel(isEnabled ? 'Disable Anti-Nuke' : 'Enable Anti-Nuke')
                        .setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success);
                    
                    const backBtn = new ButtonBuilder()
                        .setCustomId('setup_back_to_main')
                        .setLabel('⬅️ Back')
                        .setStyle(ButtonStyle.Secondary);

                    await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(toggleBtn, backBtn)] });
                    return;
                }

                if (customId === 'antinuke_toggle') {
                    if (!await safeDefer(interaction, true)) return;
                    
                    // Leer/Escribir en 'guild_backups'
                    const res = await db.query("SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1", [guildId]);
                    const newState = !(res.rows[0]?.antinuke_enabled || false);
                    
                    await db.query(`INSERT INTO guild_backups (guildid, antinuke_enabled) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET antinuke_enabled = $2`, [guildId, newState]);
                    
                    const embed = new EmbedBuilder()
                        .setTitle('🛡️ Anti-Nuke System')
                        .setDescription(`Status: **${newState ? '✅ ENABLED' : '❌ DISABLED'}**\n\nProtect your server against mass deletions and bans.`)
                        .setColor(newState ? 0x2ECC71 : 0xE74C3C);

                    const toggleBtn = new ButtonBuilder()
                        .setCustomId('antinuke_toggle')
                        .setLabel(newState ? 'Disable Anti-Nuke' : 'Enable Anti-Nuke')
                        .setStyle(newState ? ButtonStyle.Danger : ButtonStyle.Success);
                    
                    const backBtn = new ButtonBuilder()
                        .setCustomId('setup_back_to_main')
                        .setLabel('⬅️ Back')
                        .setStyle(ButtonStyle.Secondary);

                    await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(toggleBtn, backBtn)] });
                    return;
                }

                // >>> HANDLER PARA DELETE DATA <<<
                if (customId === 'delete_all_data') {
                    if (!await safeDefer(interaction, false, true)) return; 
                    
                    const confirmBtn = new ButtonBuilder().setCustomId('confirm_delete_data').setLabel('CONFIRM DELETION').setStyle(ButtonStyle.Danger);
                    const cancelBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Cancel').setStyle(ButtonStyle.Secondary);

                    await interaction.editReply({
                        content: `⚠️ **DANGER ZONE** ⚠️\nAre you sure you want to delete **ALL DATA** for this server? This includes Logs, Automod Rules, Permissions, and Settings. **This cannot be undone.**`,
                        components: [new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)]
                    });
                    return;
                }

                if (customId === 'confirm_delete_data') {
                    if (!await safeDefer(interaction, true)) return;
                    await db.query("DELETE FROM automod_rules WHERE guildid = $1", [guildId]);
                    await db.query("DELETE FROM modlogs WHERE guildid = $1", [guildId]);
                    await db.query("DELETE FROM command_permissions WHERE guildid = $1", [guildId]);
                    await db.query("DELETE FROM log_channels WHERE guildid = $1", [guildId]);
                    await db.query("DELETE FROM guild_settings WHERE guildid = $1", [guildId]);
                    await db.query("DELETE FROM appeal_blacklist WHERE guildid = $1", [guildId]);
                    await db.query("DELETE FROM pending_appeals WHERE guildid = $1", [guildId]);
                    await db.query("DELETE FROM guild_backups WHERE guildid = $1", [guildId]); 

                    await interaction.editReply({ content: `✅ All data for this guild has been wiped from the database.`, components: [] });
                    return;
                }

                // =====================================================================================
                //                           AUTOMOD SETUP
                // =====================================================================================
                if (customId === 'automod_add_rule') {
                    if (!await safeDefer(interaction, true)) return;
                    const menu = new StringSelectMenuBuilder().setCustomId('automod_action_select').setPlaceholder('1. Select punishment type...').addOptions([{ label: 'Ban', value: 'BAN' },{ label: 'Mute', value: 'MUTE' },{ label: 'Kick', value: 'KICK' }]);
                    const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_automod').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🤖 Add Automod Rule').setDescription('Select action.')], components: [new ActionRowBuilder().addComponents(menu), backButton] });
                    return;
                }
                if (customId === 'setup_automod') { 
                    if (!await safeDefer(interaction, true)) return;
                    const btns = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('automod_add_rule').setLabel('Add Rule').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('automod_remove_rule').setLabel('Remove Rule').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary)
                    );
                    const rulesRes = await db.query('SELECT * FROM automod_rules WHERE guildid = $1 ORDER BY warnings_count ASC', [guildId]);
                    const desc = rulesRes.rows.map(r => `• **${r.warnings_count} Warns:** ${r.action_type} ${r.action_duration ? `(${r.action_duration})` : ''}`).join('\n') || "No rules configured.";
                    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🤖 Automod Configuration').setDescription(desc)], components: [btns] });
                    return;
                }
                if (customId === 'automod_action_select') {
                    if (!await safeDefer(interaction, true)) return;
                    const warnOptions = Array.from({ length: 10 }, (_, i) => ({ label: `${i + 1} Warning${i > 0 ? 's' : ''}`, value: `${i + 1}:${values[0]}` }));
                    const menu = new StringSelectMenuBuilder().setCustomId('automod_warn_select').setPlaceholder(`2. Select warning count...`).addOptions(warnOptions);
                    await interaction.editReply({ components: [new ActionRowBuilder().addComponents(menu)] });
                    return;
                }
                if (customId === 'automod_warn_select') {
                    const [warnCountStr, actionType] = values[0].split(':');
                    const warnCount = parseInt(warnCountStr, 10);
                    if (actionType === 'KICK') {
                        await safeDefer(interaction, true);
                        const maxOrderResult = await db.query('SELECT MAX(rule_order) FROM automod_rules WHERE guildid = $1', [guildId]);
                        const nextRuleOrder = (maxOrderResult.rows[0].max || 0) + 1;
                        await db.query(`INSERT INTO automod_rules (guildid, rule_order, warnings_count, action_type, action_duration) VALUES ($1, $2, $3, $4, NULL) ON CONFLICT (guildid, warnings_count) DO UPDATE SET rule_order = EXCLUDED.rule_order, action_type = EXCLUDED.action_type, action_duration = EXCLUDED.action_duration`, [guildId, nextRuleOrder, warnCount, actionType]);
                        if (generateSetupContent) {
                             const { embed, components } = await generateSetupContent(interaction, guildId);
                             await interaction.editReply({ content: `✅ Automod rule saved.`, embeds: [embed], components });
                        } else await interaction.editReply({ content: `✅ Automod rule saved.` });
                        return;
                    } else {
                        const modal = new ModalBuilder().setCustomId(`automod_duration_modal:${warnCountStr}:${actionType}`).setTitle(`Set Duration`);
                        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration_value').setLabel(`Duration (e.g., 7d)`).setStyle(TextInputStyle.Short).setRequired(true)));
                        await interaction.showModal(modal);
                        return;
                    }
                }
                if (customId === 'automod_select_remove') {
                    await safeDefer(interaction, true);
                    const ruleOrder = parseInt(values[0], 10);
                    await db.query('DELETE FROM automod_rules WHERE guildid = $1 AND rule_order = $2', [guildId, ruleOrder]);
                    if (generateSetupContent) {
                        const { embed, components } = await generateSetupContent(interaction, guildId);
                        await interaction.editReply({ content: `✅ Rule deleted.`, embeds: [embed], components });
                    } else await interaction.editReply('✅ Deleted');
                    return;
                }
                if (customId === 'automod_remove_rule') {
                    if (!await safeDefer(interaction, false, true)) return;
                    const rulesResult = await db.query('SELECT rule_order, warnings_count, action_type FROM automod_rules WHERE guildid = $1 ORDER BY warnings_count ASC', [guildId]);
                    if (rulesResult.rows.length === 0) return interaction.editReply({ content: '❌ No rules found.' });
                    const options = rulesResult.rows.map(rule => ({ label: `Rule #${rule.rule_order}: ${rule.warnings_count} warns -> ${rule.action_type}`, value: rule.rule_order.toString() }));
                    const menu = new StringSelectMenuBuilder().setCustomId('automod_select_remove').setPlaceholder('Select rule to remove...').addOptions(options);
                    await interaction.editReply({ content: 'Select rule to delete:', components: [new ActionRowBuilder().addComponents(menu)] });
                    return;
                }
                if (customId.startsWith('automod_duration_modal:')) {
                    if (!await safeDefer(interaction, false, true)) return;
                    const [, warnCountStr, actionType] = customId.split(':');
                    const durationStr = interaction.fields.getTextInputValue('duration_value').trim();
                    const warnCount = parseInt(warnCountStr, 10);
                    let finalDuration = durationStr;
                    if (durationStr !== '0' && actionType !== 'KICK') {
                         const msDur = ms(durationStr);
                         if (!msDur) return interaction.editReply({ content: `${emojis.error} Invalid duration.` });
                    }
                    if (actionType === 'BAN' && durationStr === '0') finalDuration = null;
                    const maxOrderResult = await db.query('SELECT MAX(rule_order) FROM automod_rules WHERE guildid = $1', [guildId]);
                    const nextRuleOrder = (maxOrderResult.rows[0].max || 0) + 1;
                    await db.query(`INSERT INTO automod_rules (guildid, rule_order, warnings_count, action_type, action_duration) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (guildid, warnings_count) DO UPDATE SET rule_order = EXCLUDED.rule_order, action_type = EXCLUDED.action_type, action_duration = EXCLUDED.action_duration`, [guildId, nextRuleOrder, warnCount, actionType, finalDuration]);
                    if (generateSetupContent) {
                        const { embed, components } = await generateSetupContent(interaction, guildId);
                        await interaction.editReply({ content: `✅ Saved.`, embeds: [embed], components });
                    } else await interaction.editReply({ content: `✅ Saved.` });
                    return;
                }

                // --- APELACIONES ---
                if (customId === 'start_appeal_process') {
                    if (!await safeDefer(interaction, false, true)) return;
                    const openFormButton = new ButtonBuilder().setCustomId(`appeal:open_form:${interaction.user.id}`).setLabel('Open Appeal Form').setStyle(ButtonStyle.Success).setDisabled(true);
                    try {
                        if (interaction.guild.id !== APPEAL_GUILD_ID) return interaction.editReply({ content: `${emojis.error} Wrong server.`, components: [] });
                        const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID).catch(() => null);
                        if (!mainGuild) return interaction.editReply({ content: `${emojis.error} Main Guild unavailable.`, components: [] });
                        const status = await verifyAppealEligibility(interaction.user.id, mainGuild, db);
                        if (!status.valid) return interaction.editReply({ content: status.message, components: [] });
                        openFormButton.setDisabled(false);
                        await interaction.editReply({ content: `${emojis.success} **Status Verified.** You may now open the appeal form.`, components: [new ActionRowBuilder().addComponents(openFormButton)] });
                    } catch (error) {
                        console.error('[APPEAL-START]', error);
                        await interaction.editReply({ content: `${emojis.error} Error verifying status.`, components: [] });
                    }
                    return;
                }

                if (customId.startsWith('appeal:open_form:')) {
                    const userId = customId.split(':')[2];
                    if (interaction.user.id !== userId) return interaction.reply({ content: `Not your button.`, flags: [MessageFlags.Ephemeral] });
                    try {
                        const modal = new ModalBuilder().setCustomId('appeal:submit:prompt').setTitle('📝 Ban Appeal');
                        modal.addComponents(
                            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('appeal_q1').setLabel('1. Why were you banned?').setStyle(TextInputStyle.Paragraph).setMinLength(20).setRequired(true)),
                            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('appeal_q2').setLabel('2. Why should we unban you?').setStyle(TextInputStyle.Paragraph).setMinLength(20).setRequired(true)),
                            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('appeal_q3').setLabel('3. Anything else?').setStyle(TextInputStyle.Paragraph).setRequired(false))
                        );
                        await interaction.showModal(modal);
                    } catch(e) { console.error("[MODAL ERROR]", e); }
                    return;
                }

                if (interaction.isModalSubmit() && customId.startsWith('appeal:submit:')) {
                    if (!await safeDefer(interaction, false, true)) return;
                    try {
                        const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID);
                        const status = await verifyAppealEligibility(interaction.user.id, mainGuild, db);
                        if (!status.valid) return interaction.editReply({ content: status.message });

                        const q1 = interaction.fields.getTextInputValue('appeal_q1');
                        const q2 = interaction.fields.getTextInputValue('appeal_q2');
                        let q3 = 'N/A';
                        try { q3 = interaction.fields.getTextInputValue('appeal_q3') || 'N/A'; } catch (e) {}

                        const chRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'banappeal'", [MAIN_GUILD_ID]);
                        if (!chRes.rows[0]?.channel_id) return interaction.editReply({ content: "Appeal channel error." });
                        const channel = mainGuild.channels.cache.get(chRes.rows[0].channel_id);
                        
                        const caseId = `APP-${Date.now()}`;
                        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`📝 NEW BAN APPEAL`).setAuthor({ name: `${interaction.user.tag} (${interaction.user.id})`, iconURL: interaction.user.displayAvatarURL() })
                            .addFields({ name: 'Why were you banned?', value: q1 }, { name: 'Why should we unban you?', value: q2 }, { name: 'Anything else?', value: q3 })
                            .setFooter({ text: `User ID: ${interaction.user.id}` }).setTimestamp();
                        
                        const rows = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`appeal:accept:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('Accept').setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId(`appeal:reject:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
                            new ButtonBuilder().setCustomId(`appeal:blacklist:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('Blacklist & Reject').setStyle(ButtonStyle.Secondary)
                        );

                        const msg = await channel.send({ embeds: [embed], components: [rows] });
                        await db.query(`INSERT INTO pending_appeals (userid, guildid, appeal_messageid) VALUES ($1, $2, $3)`, [interaction.user.id, MAIN_GUILD_ID, msg.id]);
                        
                        try {
                            if (interaction.message) {
                                 const disabled = new ButtonBuilder().setCustomId('disabled').setLabel('Submitted').setStyle(ButtonStyle.Success).setDisabled(true);
                                 await interaction.message.edit({ components: [new ActionRowBuilder().addComponents(disabled)] });
                            }
                        } catch(e) {}
                        return interaction.editReply({ content: `${emojis.success} Appeal submitted successfully.` });
                    } catch (error) {
                        console.error('[APPEAL-SUBMIT-ERROR]', error);
                        return interaction.editReply({ content: `${emojis.error} System error processing appeal.` });
                    }
                }

                if (customId.startsWith('appeal:')) {
                    if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) return interaction.reply({ content: `No permission.`, flags: [MessageFlags.Ephemeral] });
                    await safeDefer(interaction);
                    
                    const [, decision, caseId, userId, banGuildId] = customId.split(':');
                    const user = await interaction.client.users.fetch(userId).catch(() => null);
                    const banGuild = await interaction.client.guilds.fetch(banGuildId).catch(() => null);
                    if (!user || !banGuild) return;

                    const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setFooter({ text: `${decision.toUpperCase()} by ${interaction.user.tag}` }).setTimestamp();
                    await db.query("DELETE FROM pending_appeals WHERE userid = $1 AND guildid = $2", [userId, banGuildId]);

                    let dmEmbed;
                    if (decision === 'accept') {
                        newEmbed.setColor(0x2ECC71);
                        await banGuild.members.unban(userId, `Appeal Accepted by ${interaction.user.tag}`).catch(() => {});
                        dmEmbed = new EmbedBuilder().setColor(0x2ECC71).setTitle(`${emojis.success} Appeal Status Update: APPROVED`)
                            .setAuthor({ name: banGuild.name, iconURL: banGuild.iconURL({ dynamic: true }) }).setThumbnail(banGuild.iconURL())
                            .setDescription(`Great news! Your ban appeal for **${banGuild.name}** has been reviewed and **accepted**.`)
                            .setFooter({ text: 'You are welcome to rejoin the server.' }).setTimestamp();
                        if (DISCORD_MAIN_INVITE) dmEmbed.addFields({ name: '🔗 Rejoin Server', value: `[**Click here**](${DISCORD_MAIN_INVITE})` });

                        const reason = `Appeal Accepted by ${interaction.user.tag}`;
                        const unbanCaseId = `CASE-${Date.now()}`;
                        await db.query(`INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, status) VALUES ($1, $2, 'UNBAN', $3, $4, $5, $6, 'Appeal Accepted', $7, 'EXECUTED')`, [unbanCaseId, banGuildId, userId, user.tag, interaction.user.id, interaction.user.tag, Date.now()]);
                        
                        const modLogResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'modlog'", [banGuild.id]);
                        if (modLogResult.rows[0]?.channel_id) {
                            const channel = banGuild.channels.cache.get(modLogResult.rows[0].channel_id);
                            if (channel) {
                                const modLogEmbed = new EmbedBuilder().setColor(0x2ECC71)
                                    .setAuthor({ name: `${user.tag} has been UNBANNED (Appeal)`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                                    .addFields({ name: `${emojis.user} User`, value: `${user.tag} (\`${userId}\`)`, inline: true }, { name: `${emojis.moderator} Moderator`, value: `<@${interaction.user.id}>`, inline: true }, { name: `${emojis.reason} Reason`, value: reason, inline: false })
                                    .setFooter({ text: `Case ID: ${unbanCaseId}` }).setTimestamp();
                                const sent = await channel.send({ embeds: [modLogEmbed] }).catch(() => {});
                                if (sent) await db.query("UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2", [sent.id, unbanCaseId]);
                            }
                        }
                    } else if (decision === 'reject') {
                        newEmbed.setColor(0xE74C3C);
                        dmEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle(`${emojis.error} Appeal Status Update: REJECTED`)
                            .setAuthor({ name: banGuild.name, iconURL: banGuild.iconURL({ dynamic: true }) }).setThumbnail(banGuild.iconURL())
                            .setDescription(`We regret to inform you that your ban appeal for **${banGuild.name}** has been **rejected**.`)
                            .setFooter({ text: 'This decision is final.' }).setTimestamp();
                    } else if (decision === 'blacklist') {
                        newEmbed.setColor(0x000000);
                        await db.query("INSERT INTO appeal_blacklist (userid, guildid) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, banGuildId]);
                        dmEmbed = new EmbedBuilder().setColor(0x000000).setTitle(`${emojis.void} Appeal Status Update: BLOCKED`)
                            .setAuthor({ name: banGuild.name, iconURL: banGuild.iconURL({ dynamic: true }) }).setThumbnail(banGuild.iconURL())
                            .setDescription(`Your ban appeal for **${banGuild.name}** has been rejected and you have been **blacklisted**.`)
                            .setFooter({ text: 'No further communication will be accepted.' }).setTimestamp();
                    }
                    if (dmEmbed) await user.send({ embeds: [dmEmbed] }).catch(() => {});
                    await interaction.editReply({ embeds: [newEmbed], components: [] });
                    return;
                }
                
                // --- LOGS / WARNS ---
                if (customId.startsWith('modlogs_') || customId.startsWith('warns_')) {
                    const [prefix, action, userId, authorId] = parts;
                    
                    if (action === 'next' || action === 'prev') {
                        await safeDefer(interaction, true);
                        const targetUser = await interaction.client.users.fetch(userId);
                        const isWarningLog = prefix === 'warns';
                        const logsResult = await db.query(`SELECT * FROM modlogs WHERE userid = $1 AND guildid = $2 ${isWarningLog ? "AND action = 'WARN'" : ""} ORDER BY timestamp DESC`, [userId, guildId]);
                        const logs = logsResult.rows;
                        const totalPages = Math.ceil(logs.length / logsPerPage);
                        let currentPage = 0;
                        try { currentPage = parseInt(interaction.message.embeds[0].footer.text.split(' ')[1], 10) - 1; } catch(e) {}
                        if (isNaN(currentPage)) currentPage = 0;
                        currentPage += (action === 'next' ? 1 : -1);
                        const { embed, components } = generateLogEmbed(logs, targetUser, currentPage, totalPages, authorId, isWarningLog);
                        await interaction.editReply({ embeds: [embed], components });
                    }
                    if (action === 'purge-prompt') {
                         await safeDefer(interaction, false, true);
                         const btns = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`modlogs_purge-confirm_${userId}_${authorId}`).setLabel('DELETE ALL').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`modlogs_purge-cancel_${userId}_${authorId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
                         await interaction.editReply({ content: `⚠️ **CRITICAL WARNING:** This will delete ALL logs for <@${userId}>.`, components: [btns] });
                    }
                    if (action === 'purge-confirm') {
                        await safeDefer(interaction, true);
                        await db.query("DELETE FROM modlogs WHERE userid = $1 AND guildid = $2", [userId, guildId]);
                        await interaction.editReply({ content: `✅ Logs purged.`, components: [] });
                        await interaction.message.edit({ embeds: [new EmbedBuilder().setTitle('Logs Purged').setColor(0xAA0000)], components: [] }).catch(() => {});
                    }
                    if (action === 'purge-cancel') return interaction.update({ content: `Cancelled.`, components: [] });
                    
                    if (action === 'remove-start') {
                        await safeDefer(interaction, false, true);
                        const activeWarnings = await db.query("SELECT caseid, reason FROM modlogs WHERE userid = $1 AND guildid = $2 AND action = 'WARN' AND status = 'ACTIVE' ORDER BY timestamp DESC", [userId, guildId]);
                        if (activeWarnings.rows.length === 0) return interaction.editReply("No active warnings to remove.");
                        const menu = new StringSelectMenuBuilder().setCustomId(`warns_remove-select_${userId}_${authorId}`).setPlaceholder('Select warning to annul...').addOptions(activeWarnings.rows.map(w => ({ label: `Case ${w.caseid}`, description: w.reason.substring(0, 50), value: w.caseid })));
                        await interaction.editReply({ content: "Select warning:", components: [new ActionRowBuilder().addComponents(menu)] });
                    }
                    if (action === 'remove-select') {
                        await safeDefer(interaction, true);
                        const caseIdToRemove = values[0];
                        await db.query("UPDATE modlogs SET status = 'REMOVED' WHERE caseid = $1 AND guildid = $2", [caseIdToRemove, guildId]);
                        try {
                            const logData = await db.query("SELECT logmessageid FROM modlogs WHERE caseid = $1", [caseIdToRemove]);
                            if (logData.rows[0]?.logmessageid) {
                                const chRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type='modlog'", [guildId]);
                                const channel = await interaction.client.channels.fetch(chRes.rows[0].channel_id);
                                const msg = await channel.messages.fetch(logData.rows[0].logmessageid);
                                if (msg) await msg.edit({ embeds: [EmbedBuilder.from(msg.embeds[0]).setColor(0x95A5A6).setTitle(`${emojis.warn} Warning Annulled`).setFooter({ text: `Case ${caseIdToRemove} | REMOVED` })] });
                            }
                        } catch(e) {}
                        await interaction.editReply({ content: `✅ Warning ${caseIdToRemove} removed.`, components: [] });
                    }
                    return;
                }
                
                // --- SELECT MENUS ---
                if (interaction.isChannelSelectMenu() && customId.endsWith('_channel')) {
                     await safeDefer(interaction, true);
                     const logType = customId.replace('select_', '').replace('_channel', '');
                     await db.query(`INSERT INTO log_channels (guildid, log_type, channel_id) VALUES ($1, $2, $3) ON CONFLICT(guildid, log_type) DO UPDATE SET channel_id = $3`, [guildId, logType, values[0]]);
                     if(generateSetupContent) {
                         const { embed, components } = await generateSetupContent(interaction, guildId);
                         await interaction.editReply({ embeds: [embed], components });
                     } else await interaction.editReply('✅ Saved');
                     return;
                }
                if (interaction.isRoleSelectMenu() && customId === 'select_staff_roles') {
                     await safeDefer(interaction, true);
                     await db.query(`INSERT INTO guild_settings (guildid, staff_roles) VALUES ($1, $2) ON CONFLICT(guildid) DO UPDATE SET staff_roles = $2`, [guildId, values.join(',')]);
                     if(generateSetupContent) {
                         const { embed, components } = await generateSetupContent(interaction, guildId);
                         await interaction.editReply({ embeds: [embed], components });
                     } else await interaction.editReply('✅ Saved');
                     return;
                }
                if (interaction.isStringSelectMenu() && customId === 'select_command_perms') {
                     await safeDefer(interaction, true);
                     const cmdName = values[0];
                     const menu = new RoleSelectMenuBuilder().setCustomId(`perms_role_select_${cmdName}`).setPlaceholder(`Select roles for /${cmdName}`).setMinValues(0).setMaxValues(10);
                     const back = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary);
                     await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`Permissions: /${cmdName}`).setDescription('Select allowed roles.')], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(back)] });
                     return;
                }
                if (interaction.isRoleSelectMenu() && customId.startsWith('perms_role_select_')) {
                     await safeDefer(interaction, true);
                     const cmdName = customId.replace('perms_role_select_', '');
                     await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
                     for (const rId of values) {
                         await db.query("INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, $2, $3)", [guildId, cmdName, rId]);
                     }
                     if(generateSetupContent) {
                         const { embed, components } = await generateSetupContent(interaction, guildId);
                         await interaction.editReply({ embeds: [embed], components });
                     } else await interaction.editReply('✅ Saved');
                     return;
                }
            }
        } catch (globalError) {
            console.error('[FATAL INTERACTION ERROR]', globalError);
            try { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Fatal system error.', ephemeral: true }); } catch(e) {}
        }
    },
};