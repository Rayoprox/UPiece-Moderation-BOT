const { EmbedBuilder, ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, MessageFlags, PermissionsBitField } = require('discord.js');
const { emojis, SUPREME_IDS } = require('../../utils/config.js');
const { safeDefer, verifyAppealEligibility } = require('../../utils/interactionHelpers.js');

const MAIN_GUILD_ID = process.env.DISCORD_GUILD_ID;
const APPEAL_GUILD_ID = process.env.DISCORD_APPEAL_GUILD_ID;
const DISCORD_MAIN_INVITE = process.env.DISCORD_MAIN_INVITE;

module.exports = async (interaction) => {
    const { customId, client } = interaction;
    const db = client.db;

    // --- 1. INICIAR PROCESO DE APELACIÓN ---
    if (customId === 'start_appeal_process') {
        if (!await safeDefer(interaction, false, true)) return;
        const openFormButton = new ButtonBuilder().setCustomId(`appeal:open_form:${interaction.user.id}`).setLabel('Open Appeal Form').setStyle(ButtonStyle.Success).setDisabled(true);
        try {
            if (interaction.guild.id !== APPEAL_GUILD_ID) return interaction.editReply({ content: `${emojis.error} Wrong server.`, components: [] });
            const mainGuild = await client.guilds.fetch(MAIN_GUILD_ID).catch(() => null);
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

    // --- 2. ABRIR FORMULARIO (MODAL) ---
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

    // --- 3. RECIBIR FORMULARIO (SUBMIT) ---
    if (interaction.isModalSubmit() && customId.startsWith('appeal:submit:')) {
        if (!await safeDefer(interaction, false, true)) return;
        try {
            const mainGuild = await client.guilds.fetch(MAIN_GUILD_ID);
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

    // --- 4. DECISIONES (Botones Accept/Reject/Blacklist) ---
   if (customId.startsWith('appeal:')) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) return interaction.reply({ content: `No permission.`, flags: [MessageFlags.Ephemeral] });
        
        // CORRECCIÓN AQUÍ: Pasamos 'true' para hacer un DeferUpdate (editar mensaje original)
        if (!await safeDefer(interaction, true)) return;
        
        const [, decision, caseId, userId, banGuildId] = customId.split(':');
        const user = await client.users.fetch(userId).catch(() => null);
        const banGuild = await client.guilds.fetch(banGuildId).catch(() => null);
        
        // Si no encuentra usuario o guild, avisamos y salimos
        if (!user || !banGuild) return interaction.editReply({ content: "Error: User or Guild not found.", components: [] });

        // Preparamos el Embed editado
        const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setFooter({ text: `${decision.toUpperCase()} by ${interaction.user.tag}` })
            .setTimestamp();

        // Borramos de pendientes
        await db.query("DELETE FROM pending_appeals WHERE userid = $1 AND guildid = $2", [userId, banGuildId]);

        let dmEmbed;
        if (decision === 'accept') {
            newEmbed.setColor(0x2ECC71); // Verde
            await banGuild.members.unban(userId, `Appeal Accepted by ${interaction.user.tag}`).catch(() => {});
            
            dmEmbed = new EmbedBuilder().setColor(0x2ECC71).setTitle(`${emojis.success} Appeal Status Update: APPROVED`)
                .setAuthor({ name: banGuild.name, iconURL: banGuild.iconURL({ dynamic: true }) }).setThumbnail(banGuild.iconURL())
                .setDescription(`Great news! Your ban appeal for **${banGuild.name}** has been reviewed and **accepted**.`)
                .setFooter({ text: 'You are welcome to rejoin the server.' }).setTimestamp();
            
            if (DISCORD_MAIN_INVITE) dmEmbed.addFields({ name: '🔗 Rejoin Server', value: `[**Click here**](${DISCORD_MAIN_INVITE})` });

            // LOGGING
            const reason = `Appeal Accepted by ${interaction.user.tag}`;
            const unbanCaseId = `CASE-${Date.now()}`;
            await db.query(`INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, status) VALUES ($1, $2, 'UNBAN', $3, $4, $5, $6, 'Appeal Accepted', $7, 'EXECUTED')`, [unbanCaseId, banGuildId, userId, user.tag, interaction.user.id, interaction.user.tag, Date.now()]);
            
            // Enviar Log al canal de modlogs (Opcional, si quieres mantener esto)
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
            newEmbed.setColor(0xE74C3C); // Rojo
            dmEmbed = new EmbedBuilder().setColor(0xE74C3C).setTitle(`${emojis.error} Appeal Status Update: REJECTED`)
                .setAuthor({ name: banGuild.name, iconURL: banGuild.iconURL({ dynamic: true }) }).setThumbnail(banGuild.iconURL())
                .setDescription(`We regret to inform you that your ban appeal for **${banGuild.name}** has been **rejected**.`)
                .setFooter({ text: 'This decision is final.' }).setTimestamp();

        } else if (decision === 'blacklist') {
            newEmbed.setColor(0x000000); // Negro
            await db.query("INSERT INTO appeal_blacklist (userid, guildid) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, banGuildId]);
            
            dmEmbed = new EmbedBuilder().setColor(0x000000).setTitle(`${emojis.void} Appeal Status Update: BLOCKED`)
                .setAuthor({ name: banGuild.name, iconURL: banGuild.iconURL({ dynamic: true }) }).setThumbnail(banGuild.iconURL())
                .setDescription(`Your ban appeal for **${banGuild.name}** has been rejected and you have been **blacklisted**.`)
                .setFooter({ text: 'No further communication will be accepted.' }).setTimestamp();
        }

        // Enviar DM al usuario
        if (dmEmbed) await user.send({ embeds: [dmEmbed] }).catch(() => {});
        
        // FINALMENTE: Editamos el mensaje original quitando los botones
        await interaction.editReply({ embeds: [newEmbed], components: [] });
        return;
    }
};