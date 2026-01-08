

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
        if (error.code === 10062 || error.code === 40060) {
            console.warn(`[WARN] Interaction expired or already handled. (Code: ${error.code})`);
            return false;
        }
        if (error.code === 'UND_ERR_SOCKET' || (error.message && error.message.includes('other side closed'))) {
            return false;
        }
        console.error(`[FATAL] An unhandled error occurred during deferral:`, error);
        return false;
    }
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction) return;

        const db = interaction.client.db;
        const guildId = interaction.guild?.id;

        const setupCommand = interaction.client.commands.get('setup');
        const generateSetupContent = setupCommand?.generateSetupContent; 
        
        const logsPerPage = 5;

        // --- HELPER: Generar Embed de Logs ---
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
        //                                  CHAT INPUT COMMANDS
        // =========================================================================================
        if (interaction.isChatInputCommand()) {
            console.log(`[INTERACTION] Cmd: /${interaction.commandName}, User: ${interaction.user.tag}`);
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) return interaction.reply({ content: 'Error: This command does not exist.', ephemeral: true }).catch(() => {});
            
            const isPublic = command.isPublic ?? false;
            const deferred = await safeDefer(interaction, false, !isPublic);
            if (!deferred) return;

            // Check permissions DB
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
                
                // --- COMMAND LOGGER ---
                const cmdLogResult = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [interaction.guild.id, 'cmdlog']);
                const cmdLogChannelId = cmdLogResult.rows[0]?.channel_id;
                if (cmdLogChannelId) {
                    let options = interaction.options.data;
                    let subcommand = '';
                    if (options.length > 0 && options[0].type === 2) { 
                        subcommand += ` ${options[0].name}`;
                        options = options[0].options || [];
                    }
                    if (options.length > 0 && options[0].type === 1) { 
                        subcommand += ` ${options[0].name}`;
                        options = options[0].options || [];
                    }
                    const optionsString = options.map(opt => {
                        let value = opt.value;
                        if (value === undefined || value === null) return null; 
                        if (opt.name === 'user') {
                            const user = interaction.client.users.cache.get(value);
                            value = user ? user.tag : value;
                        }
                        return `${opt.name}: ${value}`;
                    }).filter(item => item !== null).join(', ');

                    let commandPath = `/${interaction.commandName}${subcommand}`;
                    if (optionsString.length > 0) commandPath += ` (${optionsString})`;
                    
                    const logEmbed = new EmbedBuilder().setColor(0x3498DB).setTitle('Command Executed').setDescription(`Executed by <@${interaction.user.id}> in <#${interaction.channel.id}>`).addFields({ name: 'User', value: `${interaction.user.tag} (${interaction.user.id})` }, { name: 'Command', value: `\`${commandPath.trim()}\`` }).setTimestamp();
                    const channel = interaction.guild.channels.cache.get(cmdLogChannelId);
                    if (channel) channel.send({ embeds: [logEmbed] }).catch(e => console.error(`[ERROR] CmdLog Error: ${e.message}`)); 
                }
            } catch (error) {
                console.error(`[ERROR] Executing /${interaction.commandName}:`, error);
                await interaction.editReply({ content: `${emojis.error} There was an error while executing this command!` }).catch(() => {});
            }
            return; 
        }

        // =========================================================================================
        //                                  INTERACCIONES (BOTONES / MENUS)
        // =========================================================================================
        if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu() || interaction.isModalSubmit()) {
            const { customId, values } = interaction;
            const parts = customId.split('_');
            
            // Seguridad: Solo el autor del comando original puede usar sus botones (para logs y warnings)
            if (customId.startsWith('modlogs_') || customId.startsWith('warns_')) {
                 const logsAuthorId = customId.split('_').pop();
                 if (interaction.user.id !== logsAuthorId) {
                     return interaction.reply({ content: `${emojis.error} Only the user who ran the original command can use these buttons.`, flags: [MessageFlags.Ephemeral] });
                 }
            }
            
            // --- AUTOMOD SETUP ---
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

           // =====================================================================================
            //                           APPEAL PROCESS (USUARIO)
            // =====================================================================================
            
            // 1. INICIAR PROCESO (Botón en el canal de apelaciones)
             if (customId === 'start_appeal_process') {
                if (!await safeDefer(interaction, false, true)) return;
                
                // NOTA IMPORTANTE: He cambiado el ID del botón aquí para evitar conflictos con 'appeal:'
                const openFormButton = new ButtonBuilder()
                    .setCustomId(`app_form_open:${interaction.user.id}`) // <--- ID NUEVO Y ÚNICO
                    .setLabel('Open Appeal Form')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(true);

                const row = new ActionRowBuilder().addComponents(openFormButton);
                await interaction.editReply({ content: `${emojis.loading} Verifying your ban status...`, components: [row] });

                try {
                    if (interaction.guild.id !== APPEAL_GUILD_ID) return interaction.editReply({ content: `${emojis.error} Wrong server.`, components: [] });
                    
                    // Verificar Ban en Main Guild
                    const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID).catch(() => null);
                    if (!mainGuild) return interaction.editReply({ content: `${emojis.error} Main Guild unavailable.`, components: [] });
                    const banEntry = await mainGuild.bans.fetch(interaction.user.id).catch(() => null);
                    
                    if (!banEntry) {
                        await db.query("DELETE FROM pending_appeals WHERE userid = $1 AND guildid = $2", [interaction.user.id, MAIN_GUILD_ID]);
                        return interaction.editReply({ content: `${emojis.error} You are not banned.`, components: [] });
                    }
                    
                    // Verificar apelación pendiente
                    const pendingAppealResult = await db.query("SELECT appeal_messageid FROM pending_appeals WHERE userid = $1 AND guildid = $2", [interaction.user.id, MAIN_GUILD_ID]);
                    if (pendingAppealResult.rows.length > 0) {
                         // Lógica de limpieza si el mensaje ya no existe...
                         const appealChannelResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'banappeal'", [MAIN_GUILD_ID]);
                         const channelId = appealChannelResult.rows[0]?.channel_id;
                         const channel = mainGuild.channels.cache.get(channelId);
                         let msgExists = false;
                         if (channel) {
                             try { await channel.messages.fetch(pendingAppealResult.rows[0].appeal_messageid); msgExists = true; } catch(e) {}
                         }
                         if (msgExists) return interaction.editReply({ content: `${emojis.error} You already have a pending appeal.`, components: [] });
                         else await db.query("DELETE FROM pending_appeals WHERE userid = $1 AND guildid = $2", [interaction.user.id, MAIN_GUILD_ID]);
                    }
                    
                    // Verificar Blacklist y Ban Permanente
                    const banLog = await db.query("SELECT endsat FROM modlogs WHERE userid = $1 AND guildid = $2 AND action = 'BAN' ORDER BY timestamp DESC LIMIT 1", [interaction.user.id, MAIN_GUILD_ID]);
                    if (banLog.rows[0]?.endsat) return interaction.editReply({ content: `${emojis.error} Temporary bans cannot be appealed.`, components: [] });
                    
                    const bl = await db.query("SELECT * FROM appeal_blacklist WHERE userid = $1 AND guildid = $2", [interaction.user.id, MAIN_GUILD_ID]);
                    if (bl.rows.length > 0) return interaction.editReply({ content: `${emojis.error} You are blacklisted from appealing.`, components: [] });
                    
                    openFormButton.setDisabled(false);
                    await interaction.editReply({ content: `${emojis.success} Verified.`, components: [new ActionRowBuilder().addComponents(openFormButton)] });
                } catch (error) {
                    console.error('[APPEAL-START]', error);
                    await interaction.editReply({ content: `${emojis.error} System error.`, components: [] });
                }
                return;
            }

            // 2. ABRIR EL MODAL (Botón verde verificado)
            // ID NUEVO: app_form_open
             if (customId.startsWith('app_form_open:')) {
                const userId = customId.split(':')[1];
                
                // Seguridad básica
                if (interaction.user.id !== userId) {
                    return interaction.reply({ content: `Not your button.`, flags: [MessageFlags.Ephemeral] });
                }
                
                // IMPORTANTE: NO USAR DEFER AQUÍ. Los modales deben ser la PRIMERA respuesta.
                try {
                    const modal = new ModalBuilder().setCustomId('appeal:submit:prompt').setTitle('📝 Ban Appeal');
                    const q1 = new TextInputBuilder().setCustomId('appeal_q1').setLabel('Why were you banned?').setStyle(TextInputStyle.Paragraph).setMinLength(10).setRequired(true);
                    const q2 = new TextInputBuilder().setCustomId('appeal_q2').setLabel('Why unban you?').setStyle(TextInputStyle.Paragraph).setMinLength(10).setRequired(true);
                    
                    modal.addComponents(new ActionRowBuilder().addComponents(q1), new ActionRowBuilder().addComponents(q2));
                    
                    // Aquí es donde fallaba antes si había colisión de IDs
                    await interaction.showModal(modal);
                } catch(e) { 
                    console.error("[MODAL ERROR]", e); 
                    // Si falla aquí, probablemente sea lag o doble click, no podemos hacer mucho más.
                }
                return;
            }

            // 3. ENVIAR FORMULARIO (Modal Submit)
             if (interaction.isModalSubmit() && customId === 'appeal:submit:prompt') {
                if (!await safeDefer(interaction, false, true)) return;
                
                // Verificar doble envío (Race condition)
                const check = await db.query("SELECT * FROM pending_appeals WHERE userid = $1 AND guildid = $2", [interaction.user.id, MAIN_GUILD_ID]);
                if (check.rows.length > 0) return interaction.editReply({ content: `${emojis.error} Appeal already pending.` });

                // Recoger datos
                const q1 = interaction.fields.getTextInputValue('appeal_q1');
                const q2 = interaction.fields.getTextInputValue('appeal_q2');
                const caseId = `APP-${Date.now()}`;

                // Enviar al canal de Staff en Main Guild
                const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID);
                const chRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'banappeal'", [MAIN_GUILD_ID]);
                if (!chRes.rows[0]?.channel_id) return interaction.editReply({ content: "Appeal channel not configured." });
                const channel = mainGuild.channels.cache.get(chRes.rows[0].channel_id);
                
                const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`📝 NEW APPEAL`).setAuthor({ name: `${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
                    .addFields({ name: 'Reason', value: q1 }, { name: 'Defense', value: q2 })
                    .setFooter({ text: `User ID: ${interaction.user.id}` }).setTimestamp();
                
                const rows = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`appeal:accept:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('Accept').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`appeal:reject:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`appeal:blacklist:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('Blacklist').setStyle(ButtonStyle.Secondary)
                );

                const msg = await channel.send({ embeds: [embed], components: [rows] });
                await db.query(`INSERT INTO pending_appeals (userid, guildid, appeal_messageid) VALUES ($1, $2, $3)`, [interaction.user.id, MAIN_GUILD_ID, msg.id]);
                
                await interaction.editReply({ content: `${emojis.success} Appeal submitted!` });
                return;
            }
            
            // =====================================================================================
            //                           STAFF ACTIONS (ACCEPT/REJECT/BLACKLIST)
            // =====================================================================================
            
            // ESTE BLOQUE ES EXCLUSIVO PARA STAFF. 
            // AL HABER CAMBIADO EL ID DEL USUARIO A 'app_form_open', YA NO ENTRARÁ AQUÍ POR ERROR.
            if (customId.startsWith('appeal:')) {
                // Chequeo de permisos CRÍTICO
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                     return interaction.reply({ content: `${emojis.error} You do not have permission to manage appeals.`, flags: [MessageFlags.Ephemeral] });
                }
                
                await interaction.deferUpdate();
                
                const [, decision, caseId, userId, banGuildId] = customId.split(':');
                const user = await interaction.client.users.fetch(userId).catch(() => null);
                const banGuild = await interaction.client.guilds.fetch(banGuildId).catch(() => null);
                
                if (!user || !banGuild) return; // Fallo silencioso si no existen

                // Embed Base para el Staff Log (Actualizar mensaje original)
                const staffEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setFooter({ text: `${decision.toUpperCase()} by ${interaction.user.tag}` })
                    .setTimestamp();

                await db.query("DELETE FROM pending_appeals WHERE userid = $1 AND guildid = $2", [userId, banGuildId]);

                // --- ESTILOS DE EMBED PARA DM AL USUARIO ---
                let dmEmbed;

                if (decision === 'accept') {
                    staffEmbed.setColor(0x2ECC71); // Verde Staff
                    await banGuild.members.unban(userId, `Appeal Accepted by ${interaction.user.tag}`).catch(() => {});
                    
                    // DM Bonito ACEPTADO
                    dmEmbed = new EmbedBuilder()
                        .setColor(0x2ECC71)
                        .setTitle(`${emojis.success} Appeal Approved`)
                        .setDescription(`Your appeal for **${banGuild.name}** has been accepted.`)
                        .addFields({ name: 'Moderator Note', value: 'You have been unbanned. Welcome back.' })
                        .setThumbnail(banGuild.iconURL())
                        .setTimestamp();
                    if (DISCORD_MAIN_INVITE) dmEmbed.addFields({ name: 'Join Link', value: `[Click to Join](${DISCORD_MAIN_INVITE})` });

                    // Log en DB (Opcional, resumido)
                    const logId = `CASE-${Date.now()}`;
                    await db.query(`INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, status) VALUES ($1, $2, 'UNBAN', $3, $4, $5, $6, 'Appeal Accepted', $7, 'EXECUTED')`, [logId, banGuildId, userId, user.tag, interaction.user.id, interaction.user.tag, Date.now()]);

                } else if (decision === 'reject') {
                    staffEmbed.setColor(0xE74C3C); // Rojo Staff
                    
                    // DM Bonito RECHAZADO
                    dmEmbed = new EmbedBuilder()
                        .setColor(0xE74C3C)
                        .setTitle(`${emojis.error} Appeal Rejected`)
                        .setDescription(`Your appeal for **${banGuild.name}** was denied.`)
                        .addFields({ name: 'Decision', value: 'The ban remains permanent.' })
                        .setThumbnail(banGuild.iconURL())
                        .setTimestamp();

                } else if (decision === 'blacklist') {
                    staffEmbed.setColor(0x000000); // Negro Staff
                    await db.query("INSERT INTO appeal_blacklist (userid, guildid) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, banGuildId]);
                    
                    // DM Bonito BLACKLIST
                    dmEmbed = new EmbedBuilder()
                        .setColor(0x000000)
                        .setTitle(`${emojis.void} Appeal Blocked`)
                        .setDescription(`Your appeal was denied and you are **blocked** from appealing again.`)
                        .setThumbnail(banGuild.iconURL())
                        .setTimestamp();
                }

                // Enviar DM y Actualizar mensaje Staff
                if (dmEmbed) await user.send({ embeds: [dmEmbed] }).catch(() => {});
                await interaction.editReply({ embeds: [staffEmbed], components: [] });
                return;
            }

            // --- PAGINACION DE LOGS / WARNS ---
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
                    await interaction.deferUpdate();
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
                    return;
                }
                if (action === 'purge-cancel') return interaction.update({ content: `${emojis.info} Purge cancelled.`, components: [] });
            }
            
            // --- REMOVE WARNING ---
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

            // --- SETUP HELPERS ---
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
