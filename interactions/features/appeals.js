const { EmbedBuilder, ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, MessageFlags, PermissionsBitField } = require('discord.js');
const { emojis, SUPREME_IDS } = require('../../utils/config.js');
const { safeDefer, verifyAppealEligibility } = require('../../utils/interactionHelpers.js');
const { success, error } = require('../../utils/embedFactory.js');

const MAIN_GUILD_ID = process.env.DISCORD_GUILD_ID;
const APPEAL_GUILD_ID = process.env.DISCORD_APPEAL_GUILD_ID;
const DISCORD_MAIN_INVITE = process.env.DISCORD_MAIN_INVITE;

module.exports = async (interaction) => {
    const { customId, client } = interaction;
    const db = client.db;

    // --- INICIO: Botón para abrir formulario ---
    if (customId === 'start_appeal_process') {
        if (!await safeDefer(interaction, false, true)) return;
        
        const openFormButton = new ButtonBuilder()
            .setCustomId(`appeal:open_form:${interaction.user.id}`)
            .setLabel('Open Appeal Form')
            .setStyle(ButtonStyle.Success)
            .setEmoji('📝')
            .setDisabled(true);

        try {
            if (interaction.guild.id !== APPEAL_GUILD_ID) return interaction.editReply({ embeds: [error('Wrong server.')], components: [] });
            
            const mainGuild = await client.guilds.fetch(MAIN_GUILD_ID).catch(() => null);
            if (!mainGuild) return interaction.editReply({ embeds: [error('Main Guild unavailable.')], components: [] });
           
            const status = await verifyAppealEligibility(interaction.user.id, mainGuild, db);
            if (!status.valid) return interaction.editReply({ embeds: [error(status.message)], components: [] });
            
            const chRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'banappeal'", [MAIN_GUILD_ID]);
            if (!chRes.rows[0]?.channel_id) {
                return interaction.editReply({ embeds: [error('Appeal system is currently offline (Channel not configured).')], components: [] });
            }
            
            openFormButton.setDisabled(false);
            
            const readyEmbed = success('**Status Verified.** You are eligible to appeal.')
                .addFields({ name: 'Next Step', value: 'Click the button below to fill out the form.' });

            await interaction.editReply({ embeds: [readyEmbed], components: [new ActionRowBuilder().addComponents(openFormButton)] });
        } catch (err) {
            console.error('[APPEAL-START]', err);
            await interaction.editReply({ embeds: [error('Error verifying status.')], components: [] });
        }
        return;
    }

    // --- MODAL: Mostrar formulario ---
    if (customId.startsWith('appeal:open_form:')) {
        const userId = customId.split(':')[2];
        if (interaction.user.id !== userId) return interaction.reply({ content: `⛔ This form is not for you.`, flags: [MessageFlags.Ephemeral] });
        
        try {
            const modal = new ModalBuilder().setCustomId('appeal:submit:prompt').setTitle('📝 Ban Appeal Application');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('appeal_q1').setLabel('1. Why were you banned?').setStyle(TextInputStyle.Paragraph).setMinLength(20).setMaxLength(1000).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('appeal_q2').setLabel('2. Why should we unban you?').setStyle(TextInputStyle.Paragraph).setMinLength(20).setMaxLength(1000).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('appeal_q3').setLabel('3. Anything else to add?').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false))
            );
            await interaction.showModal(modal);
        } catch(e) { console.error("[MODAL ERROR]", e); }
        return;
    }

    // --- SUBMIT: Procesar formulario enviado ---
    if (interaction.isModalSubmit() && customId.startsWith('appeal:submit:')) {
        if (!await safeDefer(interaction, false, true)) return;
        try {
            const mainGuild = await client.guilds.fetch(MAIN_GUILD_ID);
            const status = await verifyAppealEligibility(interaction.user.id, mainGuild, db);
            if (!status.valid) return interaction.editReply({ embeds: [error(status.message)] });

            const q1 = interaction.fields.getTextInputValue('appeal_q1');
            const q2 = interaction.fields.getTextInputValue('appeal_q2');
            let q3 = 'N/A';
            try { q3 = interaction.fields.getTextInputValue('appeal_q3') || 'N/A'; } catch (e) {}

            const chRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'banappeal'", [MAIN_GUILD_ID]);
        
            if (!chRes.rows[0]?.channel_id) return interaction.editReply({ embeds: [error("Appeal system offline.")] });
            
            const channel = mainGuild.channels.cache.get(chRes.rows[0].channel_id);
            if (!channel) return interaction.editReply({ embeds: [error("Appeal channel not found.")] });
            
            const caseId = `APPEAL-${Date.now()}`;
            const combinedReason = `**Why banned:** ${q1}\n**Why unban:** ${q2}\n**Extra:** ${q3}`;

            const staffEmbed = new EmbedBuilder()
                .setColor(0xF1C40F)
                .setTitle(`${emojis.warn || '📝'} New Ban Appeal Received`)
                .setDescription(`A new ban appeal has been submitted and is **pending review**.`)
                .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 256 }))
                .addFields(
                    { name: '👤 User', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
                    { name: '📅 Submitted', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                    { name: '❓ 1. Why were you banned?', value: `>>> ${q1}` },
                    { name: '⚖️ 2. Why should we unban you?', value: `>>> ${q2}` },
                    { name: 'ℹ️ 3. Anything else?', value: `>>> ${q3}` }
                )
                .setFooter({ text: `Appeal Case ID: ${caseId} • Waiting for Staff action` })
                .setTimestamp();
            
            const rows = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`appeal:accept:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('Accept Appeal').setStyle(ButtonStyle.Success).setEmoji(emojis.success || '✅'),
                new ButtonBuilder().setCustomId(`appeal:reject:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('Reject').setStyle(ButtonStyle.Danger).setEmoji(emojis.error || '✖️'),
                new ButtonBuilder().setCustomId(`appeal:blacklist:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('Block & Reject').setStyle(ButtonStyle.Secondary).setEmoji('⛔')
            );

            // 1. Enviar mensaje a Discord
            const msg = await channel.send({ embeds: [staffEmbed], components: [rows] });
            
            // 2. GUARDAR EN LA BASE DE DATOS (NUEVO: Para que salga en la web)
            await db.query(
                `INSERT INTO ban_appeals (user_id, username, guild_id, reason, status, message_id, timestamp)
                 VALUES ($1, $2, $3, $4, 'PENDING', $5, $6)`,
                [
                    interaction.user.id,
                    interaction.user.tag,
                    MAIN_GUILD_ID,
                    combinedReason,
                    msg.id, // ID del mensaje para editarlo luego
                    Date.now()
                ]
            );
            
            // Deshabilitar botón original
            try {
                if (interaction.message) {
                        const disabled = new ButtonBuilder().setCustomId('disabled').setLabel('Submitted').setStyle(ButtonStyle.Success).setDisabled(true);
                        await interaction.message.edit({ components: [new ActionRowBuilder().addComponents(disabled)] });
                }
            } catch(e) {}

            return interaction.editReply({ embeds: [success('**Appeal Sent!** Our staff team will review your request shortly. You will receive a DM with the result.')] });

        } catch (err) {
            console.error('[APPEAL-SUBMIT-ERROR]', err);
            return interaction.editReply({ embeds: [error('System error processing appeal.')] });
        }
    }

    // --- ACCIONES (Botones de Discord) ---
    // NOTA: Estos botones seguirán funcionando en Discord, pero ahora también tenemos la Web API
    if (customId.startsWith('appeal:')) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) return interaction.reply({ content: `No permission.`, flags: [MessageFlags.Ephemeral] });
        if (!await safeDefer(interaction, true)) return;
        
        const [, decision, caseId, userId, banGuildId] = customId.split(':');
        const user = await client.users.fetch(userId).catch(() => null);
        const banGuild = await client.guilds.fetch(banGuildId).catch(() => null);
        
        if (!user || !banGuild) return interaction.editReply({ embeds: [error("User or Guild not found.")], components: [] });

        const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setTimestamp();
        
        // Actualizamos estado en DB también si se usa el botón de Discord
        let dbStatus = 'PENDING';

        let dmEmbed;
        if (decision === 'accept') {
            dbStatus = 'APPROVED';
            newEmbed.setColor(0x2ECC71).setTitle(`${emojis.success || '✅'} Appeal Accepted`).setDescription(`This appeal has been **APPROVED** by <@${interaction.user.id}>.`).setFooter({ text: `Approved by ${interaction.user.tag}` });
            
            await banGuild.members.unban(userId, `Appeal Accepted by ${interaction.user.tag}`).catch(() => {});
            
            dmEmbed = new EmbedBuilder().setColor(0x2ECC71).setTitle(`${emojis.success || '✅'} Appeal Status Update: APPROVED`).setAuthor({ name: banGuild.name, iconURL: banGuild.iconURL({ dynamic: true }) }).setDescription(`Great news! Your ban appeal for **${banGuild.name}** has been reviewed and **accepted**.`).setFooter({ text: 'You are welcome to rejoin the server.' }).setTimestamp();
            if (DISCORD_MAIN_INVITE) dmEmbed.addFields({ name: '🔗 Rejoin Server', value: `[**Click here**](${DISCORD_MAIN_INVITE})` });

            const unbanCaseId = caseId; 
            await db.query(`UPDATE modlogs SET status = 'EXPIRED', endsAt = NULL WHERE guildid = $1 AND userid = $2 AND status = 'ACTIVE' AND action = 'BAN'`, [banGuildId, userId]);
            await db.query(`INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, status, appealable) VALUES ($1, $2, 'UNBAN', $3, $4, $5, $6, 'Appeal Accepted', $7, 'EXECUTED', false)`, [unbanCaseId, banGuildId, userId, user.tag, interaction.user.id, interaction.user.tag, Date.now()]);

            const logRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'modlog'", [banGuildId]);
            if (logRes.rows[0]?.channel_id) {
                const logChannel = banGuild.channels.cache.get(logRes.rows[0].channel_id);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor(0x2ECC71) 
                        .setAuthor({ name: `${user.tag} has been UNBANNED`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                        .addFields(
                            { name: `${emojis.user || '👤'} User`, value: `${user.tag} (\`${user.id}\`)`, inline: true },
                            { name: `${emojis.moderator || '👮'} Moderator`, value: `<@${interaction.user.id}>`, inline: true },
                            { name: `${emojis.reason || '📝'} Reason`, value: 'Appeal Accepted', inline: false }
                        )
                        .setFooter({ text: `Case ID: ${unbanCaseId}` }) 
                        .setTimestamp();
                    
                    const sentMsg = await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                    if (sentMsg) {
                        await db.query('UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2', [sentMsg.id, unbanCaseId]);
                    }
                }
            }

        } else if (decision === 'reject') {
            dbStatus = 'REJECTED';
            newEmbed.setColor(0xE74C3C).setTitle(`${emojis.error || '❌'} Appeal Rejected`).setDescription(`This appeal has been **REJECTED** by <@${interaction.user.id}>.`).setFooter({ text: `Rejected by ${interaction.user.tag}` });
            dmEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle(`${emojis.error || '❌'} Appeal Status Update: REJECTED`).setAuthor({ name: banGuild.name, iconURL: banGuild.iconURL({ dynamic: true }) }).setDescription(`We regret to inform you that your ban appeal for **${banGuild.name}** has been **rejected**.`).setFooter({ text: 'This decision is final.' }).setTimestamp();

        } else if (decision === 'blacklist') {
            dbStatus = 'BLACKLISTED';
            newEmbed.setColor(0x000000).setTitle(`⛔ Appeal Blacklisted`).setDescription(`User has been **BLOCKED** from appealing by <@${interaction.user.id}>.`).setFooter({ text: `Blocked by ${interaction.user.tag}` });
            await db.query("INSERT INTO appeal_blacklist (userid, guildid) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, banGuildId]);
            dmEmbed = new EmbedBuilder().setColor(0x000000).setTitle(`⛔ Appeal Status Update: BLOCKED`).setAuthor({ name: banGuild.name, iconURL: banGuild.iconURL({ dynamic: true }) }).setDescription(`Your ban appeal for **${banGuild.name}** has been rejected and you have been **blacklisted**.`).setFooter({ text: 'No further communication will be accepted.' }).setTimestamp();
        }

        // Sincronizar estado con la base de datos (por si se usa la web)
        await db.query("UPDATE ban_appeals SET status = $1 WHERE message_id = $2", [dbStatus, interaction.message.id]);

        if (dmEmbed) await user.send({ embeds: [dmEmbed] }).catch(() => {});
        await interaction.editReply({ embeds: [newEmbed], components: [] });
    }
};