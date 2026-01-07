const { Events, PermissionsBitField, MessageFlags, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder } = require('discord.js');
const ms = require('ms');
const { emojis } = require('../utils/config.js');

const MAIN_GUILD_ID = process.env.DISCORD_GUILD_ID;
const APPEAL_GUILD_ID = process.env.DISCORD_APPEAL_GUILD_ID;
const DISCORD_MAIN_INVITE = process.env.DISCORD_MAIN_INVITE;

const appealInteractionUsers = new Set();

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
        // Discord API Error
        if (error.code === 10062 || error.code === 40060) {
            console.warn(`[WARN] Interaction expired or already handled. (Code: ${error.code})`);
            return false;
        }
       
        if (error.code === 'UND_ERR_SOCKET' || (error.message && error.message.includes('other side closed'))) {
            console.warn(`[WARN] Transient Network/Socket error during deferral. Interaction ignored. (Code: ${error.code || 'N/A'})`);
            return false;
        }
        
        console.error(`[FATAL] An unhandled error occurred during deferral:`, error);
        return false;
    }
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction) {
            console.error("[ERROR] InteractionCreate event fired with undefined payload. Ignoring.");
            return;
        }

        const db = interaction.client.db;
        const guildId = interaction.guild?.id;

        const setupCommand = interaction.client.commands.get('setup');
        const generateSetupContent = setupCommand?.generateSetupContent; 
        
        const logsPerPage = 5;

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

            const embed = new EmbedBuilder().setColor(isWarningLog ? 0xFFA500 : 0x3498DB).setTitle(`${isWarningLog ? emojis.warn : emojis.info} ${isWarningLog ? 'Warnings' : 'Moderation Logs'} for ${targetUser.tag}`).setDescription(description).setFooter({ text: `Page ${page + 1} of ${totalPages} | Total Logs: ${logs.length}` });
            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`${isWarningLog ? 'warns' : 'modlogs'}_prev_${targetUser.id}_${authorId}`).setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
                new ButtonBuilder().setCustomId(`${isWarningLog ? 'warns' : 'modlogs'}_next_${targetUser.id}_${authorId}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
                new ButtonBuilder().setCustomId(`modlogs_purge-prompt_${targetUser.id}_${authorId}`).setLabel('Purge All Modlogs').setStyle(ButtonStyle.Danger).setDisabled(isWarningLog)
            );
            return { embed, components: [buttons] };
        };

        if (interaction.isChatInputCommand()) {
            console.log(`[INTERACTION CREATE] Event Fired! Command: /${interaction.commandName}, User: ${interaction.user.tag}, Interaction ID: ${interaction.id}`);
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) {
                return interaction.reply({ content: 'Error: This command does not exist.', ephemeral: true }).catch(() => {});
            }
            
            const isPublic = command.isPublic ?? false;
            const deferred = await safeDefer(interaction, false, !isPublic);
            if (!deferred) return;

            
             try {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    const allowedRolesResult = await db.query('SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = $2', [interaction.guild.id, command.data.name]);
                    const allowedRoles = allowedRolesResult.rows.map(r => r.role_id);
                    let isAllowed = false;
                    if (allowedRoles.length > 0) {
                        isAllowed = interaction.member.roles.cache.some(role => allowedRoles.includes(role.id));
                    } else {
                        if (command.data.default_member_permissions) {
                            isAllowed = interaction.member.permissions.has(command.data.default_member_permissions);
                        } else { isAllowed = true; }
                    }
                    if (!isAllowed) {
                        return interaction.editReply({ content: 'You do not have the required permissions for this command.' });
                    }
                }
            } catch (dbError) {
                console.error('[ERROR] Database query for permissions failed:', dbError);
                return interaction.editReply({ content: 'A database error occurred while checking permissions.' });
            }
           
            
            try {
                await command.execute(interaction); 
                const cmdLogResult = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [interaction.guild.id, 'cmdlog']);
                const cmdLogChannelId = cmdLogResult.rows[0]?.channel_id;
                if (cmdLogChannelId) {
                    
                   
                    let options = interaction.options.data;
                    let subcommand = '';

                    // Manejar subcomandos y subcomandos de grupo
                    if (options.length > 0 && options[0].type === 2) { 
                        subcommand += ` ${options[0].name}`;
                        options = options[0].options || [];
                    }
                    if (options.length > 0 && options[0].type === 1) { 
                        subcommand += ` ${options[0].name}`;
                        options = options[0].options || [];
                    }

                    // Formatear opciones, excluyendo valores nulos/indefinidos
                    const optionsString = options.map(opt => {
                        let value = opt.value;
                        if (value === undefined || value === null) return null; 
                        
                        // Si es un ID de usuario, mostrar el tag
                        if (opt.name === 'user') {
                            const user = interaction.client.users.cache.get(value);
                            value = user ? user.tag : value;
                        }
                        
                        // Formato simple de key: value
                        return `${opt.name}: ${value}`;
                    }).filter(item => item !== null).join(', ');

                    // Usaremos solo el nombre y la ruta del comando
                    let commandPath = `/${interaction.commandName}${subcommand}`;
                    if (optionsString.length > 0) {
                        commandPath += ` (${optionsString})`;
                    }
                    
                    const fullCommand = commandPath.trim();
                    // --- FIN DE CORRECCIÓN DE FORMATO DE COMANDO ---

                    // El campo 'Command' envuelto en backticks simples ya es seguro.
                    const logEmbed = new EmbedBuilder().setColor(0x3498DB).setTitle('Command Executed').setDescription(`Executed by <@${interaction.user.id}> in <#${interaction.channel.id}>`).addFields({ name: 'User', value: `${interaction.user.tag} (${interaction.user.id})` }, { name: 'Command', value: `\`${fullCommand}\`` }).setTimestamp();
                    const channel = interaction.guild.channels.cache.get(cmdLogChannelId);
                    if (channel) { channel.send({ embeds: [logEmbed] }).catch(e => console.error(`[ERROR] Could not send command log: ${e.message}`)); }
                }
            } catch (error) {
                console.error(`[ERROR] An error occurred while executing /${interaction.commandName}:`, error);
                await interaction.editReply({ content: `${emojis.error} There was an error while executing this command!` }).catch(() => {});
            }
            return; 
        }

        if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu() || interaction.isModalSubmit()) {
            const { customId, values } = interaction;
            const parts = customId.split('_');
            
            if (customId.startsWith('modlogs_') || customId.startsWith('warns_')) {
                 const logsAuthorId = customId.split('_').pop();
                 if (interaction.user.id !== logsAuthorId) {
                     return interaction.reply({ content: `${emojis.error} Only the user who ran the original command can use these buttons.`, flags: [MessageFlags.Ephemeral] });
                 }
            }

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

                // AQUI ESTABA EL ERROR: ChannelType ahora está importado
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
                const newStatus = !(settingsRes.rows.length > 0 && settingsRes.rows[0].antinuke_enabled);

                await db.query(`INSERT INTO guild_backups (guildid, antinuke_enabled, threshold_count, threshold_time) VALUES ($1, $2, 5, 10) ON CONFLICT (guildid) DO UPDATE SET antinuke_enabled = $2`, [guildId, newStatus]);

                if (newStatus) {
                    const antiNuke = require('../utils/antiNuke.js');
                    antiNuke.createBackup(interaction.guild);
                }

                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ content: `✅ Anti-Nuke **${newStatus ? 'ENABLED' : 'DISABLED'}**.`, embeds: [embed], components });
                return;
            }
            
            if (customId === 'automod_add_rule') {
                if (!await safeDefer(interaction, true)) return;
                const menu = new StringSelectMenuBuilder().setCustomId('automod_action_select').setPlaceholder('1. Select punishment type...').addOptions([{ label: 'Ban (Permanent/Temporary)', value: 'BAN' },{ label: 'Mute (Timed only)', value: 'MUTE' },{ label: 'Kick (Instant)', value: 'KICK' }]);
                const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_automod').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🤖 Add Automod Rule - Step 1/3').setDescription('Select the action to take when the warning threshold is reached.')], components: [new ActionRowBuilder().addComponents(menu), backButton] });
                return;
            }
            
            if (customId === 'automod_remove_rule') {
                if (!await safeDefer(interaction, false, true)) return;
                const rulesResult = await db.query('SELECT rule_order, warnings_count, action_type, action_duration FROM automod_rules WHERE guildid = $1 ORDER BY warnings_count ASC', [guildId]);
                if (rulesResult.rows.length === 0) return interaction.editReply({ content: '❌ There are no Automod rules configured to remove.' });
                const options = rulesResult.rows.map(rule => ({ label: `Rule #${rule.rule_order}: ${rule.warnings_count} warns -> ${rule.action_type}${rule.action_duration ? ` (${rule.action_duration})` : ' (Permanent)'}`, value: rule.rule_order.toString() }));
                const menu = new StringSelectMenuBuilder().setCustomId('automod_select_remove').setPlaceholder('Select the rule number to remove...').addOptions(options);
                return interaction.editReply({ content: 'Please select the rule you wish to **permanently delete**:', components: [new ActionRowBuilder().addComponents(menu)] });
            }

            if (customId === 'automod_action_select') {
                if (!await safeDefer(interaction, true)) return;
                const actionType = values[0];
                const warnOptions = Array.from({ length: 10 }, (_, i) => ({ label: `${i + 1} Warning${i > 0 ? 's' : ''}`, value: `${i + 1}:${actionType}` }));
                const menu = new StringSelectMenuBuilder().setCustomId('automod_warn_select').setPlaceholder(`2. Select warning count for ${actionType}...`).addOptions(warnOptions);
                const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_automod').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🤖 Add Automod Rule - Step 2/3').setDescription(`Action selected: **${actionType}**. Now select the warning count.`)], components: [new ActionRowBuilder().addComponents(menu), backButton] });
                return;
            }
            
            if (customId === 'automod_warn_select') {
                const [warnCountStr, actionType] = values[0].split(':');
                const warnCount = parseInt(warnCountStr, 10);

                if (actionType === 'KICK') {
                    await interaction.deferUpdate();
                    try {
                        const maxOrderResult = await db.query('SELECT MAX(rule_order) FROM automod_rules WHERE guildid = $1', [guildId]);
                        const nextRuleOrder = (maxOrderResult.rows[0].max || 0) + 1;
                        await db.query(`INSERT INTO automod_rules (guildid, rule_order, warnings_count, action_type, action_duration) VALUES ($1, $2, $3, $4, NULL) ON CONFLICT (guildid, warnings_count) DO UPDATE SET rule_order = EXCLUDED.rule_order, action_type = EXCLUDED.action_type, action_duration = EXCLUDED.action_duration`, [guildId, nextRuleOrder, warnCount, actionType]);
                        const { embed: updatedEmbed, components: updatedComponents } = await generateSetupContent(interaction, guildId);
                        await interaction.editReply({ content: `✅ Automod rule for **${warnCount} warns** has been created (Action: Kick).`, embeds: [updatedEmbed], components: updatedComponents });
                    } catch (error) {
                        console.error('[ERROR] Failed to save KICK rule:', error);
                        await interaction.editReply({ content: '❌ An unexpected database error occurred saving the KICK rule.' });
                    }
                    return;
                } else {
                    const modal = new ModalBuilder().setCustomId(`automod_duration_modal:${warnCountStr}:${actionType}`).setTitle(`Set Duration for ${actionType}`);
                    const durationInput = new TextInputBuilder().setCustomId('duration_value').setLabel(`Enter Duration (e.g., 7d, 1h)`).setPlaceholder(`Max: ${actionType === 'MUTE' ? '28d' : 'Permanent (e.g., 7d, 0)'} | Use '0' for permanent BAN.`).setStyle(TextInputStyle.Short).setRequired(true);
                    modal.addComponents(new ActionRowBuilder().addComponents(durationInput));
                    await interaction.showModal(modal);
                    return;
                }
            }
            
            if (customId === 'automod_select_remove' && generateSetupContent) {
                await interaction.deferUpdate();
                const ruleOrder = parseInt(values[0], 10);
                try {
                    const result = await db.query('DELETE FROM automod_rules WHERE guildid = $1 AND rule_order = $2 RETURNING warnings_count', [guildId, ruleOrder]);
                    const deletedWarnCount = result.rows[0]?.warnings_count;
                    const remainingRulesResult = await db.query('SELECT id FROM automod_rules WHERE guildid = $1 ORDER BY warnings_count ASC', [guildId]);
                    for (const [i, rule] of remainingRulesResult.rows.entries()) {
                        await db.query('UPDATE automod_rules SET rule_order = $1 WHERE id = $2', [i + 1, rule.id]);
                    }
                    const { embed: updatedEmbed, components: updatedComponents } = await generateSetupContent(interaction, guildId);
                    await interaction.editReply({ content: `✅ Automod rule #${ruleOrder} (for **${deletedWarnCount} warns**) has been **permanently deleted** and re-indexed.`, embeds: [updatedEmbed], components: updatedComponents });
                } catch (error) {
                    console.error('[ERROR] Failed to delete automod rule:', error);
                    await interaction.editReply({ content: `❌ Error: Failed to delete rule #${ruleOrder}.`, components: [] });
                }
                return;
            }
            // STAR APPEAL
             if (customId === 'start_appeal_process') {
                if (!await safeDefer(interaction, false, true)) return;
                const openFormButton = new ButtonBuilder().setCustomId(`appeal:open_form:${interaction.user.id}`).setLabel('Open Appeal Form').setStyle(ButtonStyle.Success).setDisabled(true);
                const row = new ActionRowBuilder().addComponents(openFormButton);
                await interaction.editReply({ content: `${emojis.loading} Verifying your ban status...`, components: [row] });

                try {
                    if (interaction.guild.id !== APPEAL_GUILD_ID) return interaction.editReply({ content: `${emojis.error} This button must be used in the designated appeal server.`, components: [] });
                    const appealChannelResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2", [MAIN_GUILD_ID, 'banappeal']);
                    if (appealChannelResult.rows.length === 0) return interaction.editReply({ content: `${emojis.error} The Ban Appeal log channel is not configured in the Main Guild.`, components: [] });
                    const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID).catch(() => null);
                    if (!mainGuild) return interaction.editReply({ content: `${emojis.error} Cannot access the Main Guild.`, components: [] });
                    const banEntry = await mainGuild.bans.fetch(interaction.user.id).catch(() => null);
                    
                    // --- LÓGICA DE REINICIO DE APPEALS Y VERIFICACIÓN DE BAN ---
                    if (!banEntry) {
                        await db.query("DELETE FROM pending_appeals WHERE userid = $1 AND guildid = $2", [interaction.user.id, MAIN_GUILD_ID]);
                        return interaction.editReply({ content: `${emojis.error} You are not currently banned from **${mainGuild.name}** (Appeal process reset).`, components: [] });
                    }
                    
                    // --- LÓGICA: CHEQUEAR APPEAL PENDIENTE Y SU ESTADO ---
                    const pendingAppealResult = await db.query("SELECT appeal_messageid FROM pending_appeals WHERE userid = $1 AND guildid = $2", [interaction.user.id, MAIN_GUILD_ID]);
                    if (pendingAppealResult.rows.length > 0) {
                        const appealLogChannelId = appealChannelResult.rows[0]?.channel_id;
                        const appealChannel = mainGuild.channels.cache.get(appealLogChannelId);
                        
                        // Verificar si el mensaje de apelación existe todavía
                        const appealMessageId = pendingAppealResult.rows[0].appeal_messageid;
                        const messageExists = await appealChannel?.messages.fetch(appealMessageId).then(() => true).catch(() => false);

                        if (messageExists) {
                            return interaction.editReply({ content: `${emojis.error} You already have an active ban appeal pending review. Please wait for a decision before submitting a new one.`, components: [] });
                        } else {
                            // Si el mensaje fue eliminado manualmente, limpiar el registro
                            await db.query("DELETE FROM pending_appeals WHERE userid = $1 AND guildid = $2", [interaction.user.id, MAIN_GUILD_ID]);
                            console.warn(`[APPEAL CLEANUP] Deleted stale pending appeal for ${interaction.user.tag}. Message ${appealMessageId} was not found.`);
                           
                        }
                    }
                    // ---------------------------------------------
                    
                    const banLogResult = await db.query("SELECT * FROM modlogs WHERE userid = $1 AND guildid = $2 AND action = 'BAN' AND (status = 'ACTIVE' OR status = 'PERMANENT') ORDER BY timestamp DESC LIMIT 1", [interaction.user.id, MAIN_GUILD_ID]);
                    const banLog = banLogResult.rows[0];
                    if (banLog && banLog.endsat) {
                        const endsAtTimestamp = Math.floor(Number(banLog.endsat) / 1000);
                        return interaction.editReply({ content: `${emojis.error} Your ban is temporary and cannot be appealed. It will automatically expire on <t:${endsAtTimestamp}:f>.`, components: [] });
                    }
                    const blacklistResult = await db.query("SELECT * FROM appeal_blacklist WHERE userid = $1 AND guildid = $2", [interaction.user.id, MAIN_GUILD_ID]);
                    if (blacklistResult.rows.length > 0) return interaction.editReply({ content: `${emojis.error} Your appeal for the Main Guild is currently **blacklisted**.`, components: [] });
                    openFormButton.setDisabled(false);
                    await interaction.editReply({ content: `${emojis.success} Verification successful. You can now open the appeal form.`, components: [new ActionRowBuilder().addComponents(openFormButton)] });
                } catch (error) {
                    console.error('[ERROR] Failed during appeal verification:', error);
                    await interaction.editReply({ content: `${emojis.error} An unexpected error occurred during verification.`, components: [] });
                }
                return;
            }

            // Seguridad - OPEN FORM (SOLO ABRE EL MODAL)
             if (customId.startsWith('appeal:open_form:')) {
                const userId = customId.split(':')[2];
                if (interaction.user.id !== userId) {
                    return interaction.reply({ content: `${emojis.error} You can only use the button from your own appeal request.`, flags: [MessageFlags.Ephemeral] });
                }
                // NO SE REALIZA NINGUNA OTRA VERIFICACIÓN AQUÍ.
                
                try {
                    const modal = new ModalBuilder().setCustomId('appeal:submit:prompt').setTitle('📝 Ban Appeal Application');
                    const q1 = new TextInputBuilder().setCustomId('appeal_q1').setLabel('1. Why were you banned?').setStyle(TextInputStyle.Paragraph).setMinLength(20).setMaxLength(1000).setRequired(true);
                    const q2 = new TextInputBuilder().setCustomId('appeal_q2').setLabel('2. Why should your appeal be accepted?').setStyle(TextInputStyle.Paragraph).setMinLength(20).setMaxLength(1000).setRequired(true);
                    const q3 = new TextInputBuilder().setCustomId('appeal_q3').setLabel('3. Anything else to add?').setStyle(TextInputStyle.Paragraph).setRequired(false);
                    modal.addComponents(new ActionRowBuilder().addComponents(q1), new ActionRowBuilder().addComponents(q2), new ActionRowBuilder().addComponents(q3));
                    await interaction.showModal(modal);
                } catch(e) { console.error("[ERROR] Error showing modal:", e); }
                return;
            }

             if (interaction.isModalSubmit()) {
                if (customId.startsWith('appeal:submit:')) {
                    if (!await safeDefer(interaction, false, true)) return;
                    
                  
                    const pendingAppealResult = await db.query("SELECT * FROM pending_appeals WHERE userid = $1 AND guildid = $2", [interaction.user.id, MAIN_GUILD_ID]);
                    if (pendingAppealResult.rows.length > 0) {
                        return interaction.editReply({ content: `${emojis.error} You already have an active ban appeal pending review. Please wait for a decision.` });
                    }
                 
                    
                    try {
                        const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID).catch(() => null);
                        if (!mainGuild) return interaction.editReply({ content: `${emojis.error} Cannot access the Main Guild.` });
                        const banEntry = await mainGuild.bans.fetch(interaction.user.id).catch(() => null);
                        if (!banEntry) {
                            await db.query("DELETE FROM pending_appeals WHERE userid = $1 AND guildid = $2", [interaction.user.id, MAIN_GUILD_ID]); // Limpiar por si acaso
                            return interaction.editReply({ content: `${emojis.error} You are no longer banned and cannot submit an appeal.` });
                        }
                        const blacklistResult = await db.query("SELECT * FROM appeal_blacklist WHERE userid = $1 AND guildid = $2", [interaction.user.id, MAIN_GUILD_ID]);
                        if (blacklistResult.rows.length > 0) return interaction.editReply({ content: `${emojis.error} Your appeal cannot be submitted because you have been blacklisted.` });
                    } catch (verificationError) {
                        console.error('[ERROR] Failed during appeal submission verification:', verificationError);
                        return interaction.editReply({ content: `${emojis.error} An unexpected error occurred during final verification.` });
                    }
                    
                    const q1 = interaction.fields.getTextInputValue('appeal_q1');
                    const q2 = interaction.fields.getTextInputValue('appeal_q2');
                    const q3 = interaction.fields.getTextInputValue('appeal_q3') || 'N/A';
                    const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID);
                    const appealChannelResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2", [MAIN_GUILD_ID, 'banappeal']);
                    const appealChannelId = appealChannelResult.rows[0]?.channel_id;
                    if (!appealChannelId) return interaction.editReply({ content: `${emojis.error} Appeal log channel not configured.` });
                    const appealChannel = mainGuild.channels.cache.get(appealChannelId);
                    if (!appealChannel) return interaction.editReply({ content: `${emojis.error} Appeal log channel inaccessible.` });
                    const caseId = `MANUAL-APP-${Date.now()}`;
                    const appealEmbed = new EmbedBuilder().setColor(0x5865F2).setTitle(`📝 NEW BAN APPEAL`).setAuthor({ name: `${interaction.user.tag} (${interaction.user.id})`, iconURL: interaction.user.displayAvatarURL() }).addFields({ name: 'Why were you banned?', value: q1 }, { name: 'Why should we unban you?', value: q2 }, { name: 'Anything else?', value: q3 }).setTimestamp();
                    const actionRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`appeal:accept:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('Accept').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`appeal:reject:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId(`appeal:blacklist:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('Blacklist & Reject').setStyle(ButtonStyle.Secondary)
                    );
                    const appealMessage = await appealChannel.send({ embeds: [appealEmbed], components: [actionRow] });
                    
                    
                    if (appealMessage) {
                         await db.query(`INSERT INTO pending_appeals (userid, guildid, appeal_messageid) VALUES ($1, $2, $3)`, [interaction.user.id, MAIN_GUILD_ID, appealMessage.id]);
                    }
                   
                    
                    try {
                        if (interaction.message && interaction.message.components.length > 0) {
                            const disabledButton = new ButtonBuilder().setCustomId(interaction.message.components[0].components[0].customId).setLabel('Form Submitted').setStyle(ButtonStyle.Success).setDisabled(true);
                            const newActionRow = new ActionRowBuilder().addComponents(disabledButton);
                            await interaction.message.edit({ components: [newActionRow] });
                        }
                    } catch (editError) {
                        console.warn(`[WARN] Could not disable the 'Open Form' button after submission: ${editError.message}`);
                    }
                    return interaction.editReply({ content: `${emojis.success} Your appeal has been submitted for review.` });
                }

             if (customId.startsWith('automod_duration_modal:')) {
                if (!await safeDefer(interaction, false, true)) return;
                
                const parts = customId.split(':');
                if (parts.length !== 3) return interaction.editReply({ content: `${emojis.error} Modal ID format error.` });

                const [, warnCountStr, actionType] = parts;
                const durationStr = interaction.fields.getTextInputValue('duration_value').trim();
                const warnCount = parseInt(warnCountStr, 10);
                
                let durationMs = 0;
                let finalDuration = durationStr;
                
                if (durationStr !== '0') {
                    // Validar duración usando ms
                    durationMs = ms(durationStr);
                    if (!durationMs || durationMs < 5000 || durationMs > 2419200000) {
                        return interaction.editReply({ content: `${emojis.error} Invalid duration. Must be between 5s and 28d (or '0' for permanent ban).` });
                    }
                } else if (actionType === 'MUTE') {
                     return interaction.editReply({ content: `${emojis.error} MUTE must have a duration (cannot be permanent).` });
                } else if (actionType === 'BAN' && durationStr === '0') {
                    finalDuration = null; // null en DB significa permanente
                }
                
               
                try {
                    const maxOrderResult = await db.query('SELECT MAX(rule_order) FROM automod_rules WHERE guildid = $1', [guildId]);
                    const nextRuleOrder = (maxOrderResult.rows[0].max || 0) + 1;
                    
                    await db.query(`
                        INSERT INTO automod_rules (guildid, rule_order, warnings_count, action_type, action_duration) 
                        VALUES ($1, $2, $3, $4, $5) 
                        ON CONFLICT (guildid, warnings_count) DO UPDATE 
                        SET rule_order = EXCLUDED.rule_order, action_type = EXCLUDED.action_type, action_duration = EXCLUDED.action_duration
                    `, [guildId, nextRuleOrder, warnCount, actionType, finalDuration]);
                    
                   
                    const { embed: updatedEmbed, components: updatedComponents } = await generateSetupContent(interaction, guildId);
                    
                    await interaction.editReply({ 
                        content: `${emojis.success} Automod rule for **${warnCount} warns** has been created (Action: ${actionType}, Duration: ${finalDuration || 'Permanent'}).`, 
                        embeds: [updatedEmbed], 
                        components: updatedComponents 
                    });
                    
                } catch (error) {
                    console.error('[ERROR] Failed to save Automod rule via Modal:', error);
                    await interaction.editReply({ content: `${emojis.error} An unexpected database error occurred while saving the rule.` });
                }
                
                return;
            }
            }
            
          if (customId.startsWith('appeal:')) {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) return interaction.reply({ content: `${emojis.error} You do not have permission to manage appeals.`, flags: [MessageFlags.Ephemeral] });
                
                
                try {
                    await interaction.deferUpdate();
                } catch (error) {
                    if (error.code === 10062 || error.code === 40060) {
                        return console.warn(`[WARN] Appeal interaction ${interaction.id} expired or acknowledged (Code: ${error.code}). Ignoring.`);
                    }
                    throw error;
                }
                
                const [, decision, caseId, userId, banGuildId] = customId.split(':');
                const user = await interaction.client.users.fetch(userId).catch(() => null);
                const banGuild = await interaction.client.guilds.fetch(banGuildId).catch(() => null);
                if (!user || !banGuild) return interaction.editReply({ content: `${emojis.error} Error: Cannot process.` });
                const originalEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(originalEmbed).setFooter({ text: `${decision.toUpperCase()} by ${interaction.user.tag}` }).setTimestamp();

            
                await db.query("DELETE FROM pending_appeals WHERE userid = $1 AND guildid = $2", [userId, banGuildId]);
               
                
                switch (decision) {
                    case 'accept': {
                        newEmbed.setColor(0x2ECC71);
                        const reason = `Appeal Accepted by ${interaction.user.tag}`;
                        await banGuild.members.unban(userId, reason).catch(() => {});
                        const acceptEmbed = new EmbedBuilder().setColor(0x2ECC71).setTitle(`${emojis.success} Appeal Accepted`).setDescription(`Your ban appeal for the server **${banGuild.name}** has been accepted.`).setTimestamp();
                        if (DISCORD_MAIN_INVITE) {
                            acceptEmbed.addFields({ name: 'Rejoin the Server', value: `You may now rejoin by [clicking here](${DISCORD_MAIN_INVITE}).` });
                        }
                        await user.send({ embeds: [acceptEmbed] }).catch(() => {});
                        const unbanCaseId = `CASE-${Date.now()}`;
                        const currentTimestamp = Date.now();
                        await db.query(`INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [unbanCaseId, banGuild.id, 'UNBAN', user.id, user.tag, interaction.user.id, interaction.user.tag, reason, currentTimestamp, 'EXECUTED']);
                        const modLogResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'modlog'", [banGuild.id]);
                        const modLogChannelId = modLogResult.rows[0]?.channel_id;
                        if (modLogChannelId) {
                            const channel = banGuild.channels.cache.get(modLogChannelId);
                            if (channel) {
                                const modLogEmbed = new EmbedBuilder().setColor(0x2ECC71).setAuthor({ name: `${user.tag} has been UNBANNED`, iconURL: user.displayAvatarURL({ dynamic: true }) }).addFields({ name: `${emojis.user} User`, value: `${user.tag} (\`${userId}\`)`, inline: true }, { name: `${emojis.moderator} Moderator`, value: `<@${interaction.user.id}>`, inline: true }, { name: `${emojis.reason} Reason for Unban`, value: reason, inline: false }).setFooter({ text: `Case ID: ${unbanCaseId}` }).setTimestamp();
                                const sentMessage = await channel.send({ embeds: [modLogEmbed] }).catch(console.error);
                                if (sentMessage) { await db.query("UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2", [sentMessage.id, unbanCaseId]); }
                            }
                        }
                        break;
                    }
                    case 'reject':
                        newEmbed.setColor(0xE74C3C);
                        const rejectEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle(`${emojis.error} Appeal Rejected`).setDescription(`Unfortunately, your ban appeal for the server **${banGuild.name}** has been rejected.`).setTimestamp();
                        await user.send({ embeds: [rejectEmbed] }).catch(() => {});
                        break;
                    case 'blacklist':
                        newEmbed.setColor(0x000000);
                        await db.query("INSERT INTO appeal_blacklist (userid, guildid) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, banGuildId]);
                        const blacklistEmbed = new EmbedBuilder().setColor(0x000000).setTitle(`${emojis.error} Appeal Rejected & Blacklisted`).setDescription(`Your ban appeal for **${banGuild.name}** has been rejected. You have been blacklisted from submitting future appeals for this ban.`).setTimestamp();
                        await user.send({ embeds: [blacklistEmbed] }).catch(() => {});
                        break;
                }
                await interaction.editReply({ embeds: [newEmbed], components: [] });
            }


            if (customId.startsWith('modlogs_') || customId.startsWith('warns_')) {
                const [prefix, action, userId, authorId] = parts;
                if (interaction.user.id !== authorId) return interaction.reply({ content: `${emojis.error} Only the user who ran the original command can use these buttons.`, flags: [MessageFlags.Ephemeral] });
               
                
                if (action === 'next' || action === 'prev') {
                    await interaction.deferUpdate();
                    const targetUser = await interaction.client.users.fetch(userId);
                    const isWarningLog = prefix === 'warns';
                    const logsResult = await db.query(`SELECT * FROM modlogs WHERE userid = $1 AND guildid = $2 ${isWarningLog ? "AND action = 'WARN'" : ""} ORDER BY timestamp DESC`, [userId, guildId]);
                    const logs = logsResult.rows;
                    const totalPages = Math.ceil(logs.length / logsPerPage);
                    let currentPage = parseInt(interaction.message.embeds[0].footer.text.split(' ')[1], 10) - 1;
                    currentPage += (action === 'next' ? 1 : -1);
                    const { embed, components } = generateLogEmbed(logs, targetUser, currentPage, totalPages, authorId, isWarningLog);
                    await interaction.editReply({ embeds: [embed], components });
                    return;
                }

               
               if (action === 'purge-prompt') {
                    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: `${emojis.error} You need Administrator permissions.`, flags: [MessageFlags.Ephemeral] });
                    await interaction.deferReply({ ephemeral: true });
                    const confirmationButtons = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`modlogs_purge-confirm_${userId}_${authorId}`).setLabel('Yes, Delete PERMANENTLY').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`modlogs_purge-cancel_${userId}_${authorId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
                    return interaction.editReply({ content: `${emojis.warn} **PERMANENT DELETE WARNING:** Are you sure you want to delete **ALL** moderation logs for <@${userId}>? This cannot be undone.`, components: [confirmationButtons] });
                }
                 if (action === 'purge-confirm') {
                    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
                    if (!await safeDefer(interaction, true)) return;

                    const activePunishmentsResult = await db.query("SELECT caseid, action FROM modlogs WHERE userid = $1 AND guildid = $2 AND status = 'ACTIVE' AND (action = 'TIMEOUT' OR action = 'BAN')", [userId, interaction.guild.id]);
                    if (activePunishmentsResult.rows.length > 0) {
                        const activeCase = activePunishmentsResult.rows[0];
                        return interaction.editReply({ content: `${emojis.error} You cannot purge logs for this user as they have an active **${activeCase.action}** (Case ID: \`${activeCase.caseid}\`). Please remove all active punishments with timers before purging their logs.`, components: [] });
                    }

                    const targetUser = await interaction.client.users.fetch(userId);
                    await db.query("DELETE FROM modlogs WHERE userid = $1 AND guildid = $2", [userId, interaction.guild.id]);
                    
                    await interaction.editReply({ content: `${emojis.success} All **${targetUser.tag}** modlogs have been **PERMANENTLY DELETED**.`, components: [] });
                    
                    const purgedEmbed = new EmbedBuilder().setTitle(`${emojis.void} Logs Purged`).setDescription(`The logs for this user were purged by <@${interaction.user.id}>.`).setColor(0xAA0000);
                    await interaction.message.edit({ embeds: [purgedEmbed], components: [] }).catch(() => {});

                    try {
                        const cmdLogResult = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [interaction.guild.id, 'cmdlog']);
                        const cmdLogChannelId = cmdLogResult.rows[0]?.channel_id;
                        
                        if (cmdLogChannelId) {
                            const logEmbed = new EmbedBuilder()
                                .setColor(0xAA0000)
                                .setTitle('🗑️ Logs Purged Manually')
                                .setDescription(`**Target User:** <@${userId}> (\`${userId}\`)\n**Executor:** <@${interaction.user.id}> (<t:${Math.floor(Date.now() / 1000)}:R>)\n**Action:** Clicked "Delete PERMANENTLY" button on /modlogs.`)
                                .setTimestamp();
                            
                            const channel = interaction.guild.channels.cache.get(cmdLogChannelId);
                            if (channel) await channel.send({ embeds: [logEmbed] }).catch(() => {});
                        }
                    } catch (error) {
                        console.error(error);
                    }
                    return;
                }

                if (action === 'purge-cancel') return interaction.update({ content: `${emojis.info} Purge cancelled.`, components: [] });
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
            if (interaction.isChannelSelectMenu() && customId.endsWith('_channel') && generateSetupContent) {
                await interaction.deferUpdate();
                const logType = customId.replace('select_', '').replace('_channel', '');
                await db.query(`INSERT INTO log_channels (guildid, log_type, channel_id) VALUES ($1, $2, $3) ON CONFLICT(guildid, log_type) DO UPDATE SET channel_id = $3`, [guildId, logType, values[0]]);
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ embeds: [embed], components: components });
                return;
            }

            if (interaction.isRoleSelectMenu() && (customId === 'select_staff_roles' || customId.startsWith('perms_role_select_')) && generateSetupContent) {
                await interaction.deferUpdate();
                if (customId === 'select_staff_roles') {
                    await db.query(`INSERT INTO guild_settings (guildid, staff_roles) VALUES ($1, $2) ON CONFLICT(guildid) DO UPDATE SET staff_roles = $2`, [guildId, values.join(',')]);
                } else {
                    const commandName = customId.replace('perms_role_select_', '');
                    await db.query('DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2', [guildId, commandName]);
                    for (const roleId of values) {
                        await db.query('INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, $2, $3)', [guildId, commandName, roleId]);
                    }
                }
                const { embed: updatedEmbed, components: updatedComponents } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ content: '✅ Settings updated.', embeds: [updatedEmbed], components: updatedComponents });
                return;
            }

            if (interaction.isStringSelectMenu() && customId === 'select_command_perms') {
                await interaction.deferUpdate();
                const commandName = values[0];
                const menu = new RoleSelectMenuBuilder().setCustomId(`perms_role_select_${commandName}`).setPlaceholder(`Select roles for /${commandName}...`).setMinValues(0).setMaxValues(25);
                const actionButtons = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Volver').setStyle(ButtonStyle.Secondary));
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`Permissions for /${commandName}`).setDescription('Select roles that can use this command.')], components: [new ActionRowBuilder().addComponents(menu), actionButtons] });
                return;
            }
        }
    },
};