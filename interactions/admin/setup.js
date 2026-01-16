const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder, 
    RoleSelectMenuBuilder, 
    ChannelSelectMenuBuilder, 
    ChannelType, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle 
} = require('discord.js');
const { safeDefer } = require('../../utils/interactionHelpers.js');
const { success, error } = require('../../utils/embedFactory.js');
const { STAFF_COMMANDS } = require('../../utils/config.js');

module.exports = async (interaction) => {
    const { customId, guild, client, values, fields } = interaction;
    const db = client.db;
    const guildId = guild.id;
    
    const setupCommand = client.commands.get('setup');
    const generateSetupContent = setupCommand?.generateSetupContent;

    // =======================
    // 🎫 TICKET SYSTEM CORE 
    // ======================

   
    if (customId === 'setup_tickets_menu') {
        if (!await safeDefer(interaction, true)) return;

        const panels = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 ORDER BY id ASC', [guildId]);
        
        const embed = new EmbedBuilder()
            .setTitle('🎫 Ticket System Configuration')
            .setDescription(`Manage your support ticket panels here.\n\n**Current Panels:**\n${panels.rows.length > 0 ? panels.rows.map(p => `• **${p.title}** (ID: \`${p.panel_id}\`)`).join('\n') : '_No panels created yet._'}`)
            .setColor('#5865F2')
            .setFooter({ text: 'You can have multiple panels for different purposes.' });

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket_panel_create').setLabel('Create New Panel').setStyle(ButtonStyle.Success).setEmoji('➕'),
            new ButtonBuilder().setCustomId('ticket_panel_edit_select').setLabel('Edit Panel').setStyle(ButtonStyle.Primary).setEmoji('✏️').setDisabled(panels.rows.length === 0),
            new ButtonBuilder().setCustomId('ticket_panel_delete_select').setLabel('Delete Panel').setStyle(ButtonStyle.Danger).setEmoji('🗑️').setDisabled(panels.rows.length === 0),
            new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [embed], components: [buttons] });
        return;
    }


    if (customId === 'ticket_panel_create') {
        const modal = new ModalBuilder().setCustomId('ticket_panel_create_modal').setTitle('Create Ticket Panel');
        const idInput = new TextInputBuilder().setCustomId('panel_unique_id').setLabel("Panel ID (Unique, e.g., 'support')").setStyle(TextInputStyle.Short).setPlaceholder('support').setRequired(true).setMaxLength(20);
        const titleInput = new TextInputBuilder().setCustomId('panel_title').setLabel("Embed Title").setStyle(TextInputStyle.Short).setPlaceholder('Support Tickets').setRequired(true).setMaxLength(100);

        modal.addComponents(new ActionRowBuilder().addComponents(idInput), new ActionRowBuilder().addComponents(titleInput));
        await interaction.showModal(modal);
        return;
    }

    
    if (customId === 'ticket_panel_create_modal') {
        if (!await safeDefer(interaction, true)) return;

        const panelId = fields.getTextInputValue('panel_unique_id').toLowerCase().replace(/[^a-z0-9-_]/g, '');
        const title = fields.getTextInputValue('panel_title');

        const check = await db.query('SELECT id FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
        if (check.rows.length > 0) return interaction.editReply({ embeds: [error(`A panel with ID \`${panelId}\` already exists. Please choose a unique ID.`)] });

        await db.query(`INSERT INTO ticket_panels (guild_id, panel_id, title) VALUES ($1, $2, $3)`, [guildId, panelId, title]);
        return showPanelDashboard(interaction, db, guildId, panelId, true);
    }


    if (customId === 'ticket_panel_edit_select') {
        if (!await safeDefer(interaction, true)) return;
        const panels = await db.query('SELECT panel_id, title FROM ticket_panels WHERE guild_id = $1', [guildId]);
        
        const menu = new StringSelectMenuBuilder()
            .setCustomId('ticket_panel_select_action')
            .setPlaceholder('Select a panel to configure...')
            .addOptions(panels.rows.map(p => ({ label: p.title, value: p.panel_id, description: `ID: ${p.panel_id}` })));

        const backBtn = new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Back').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✏️ Edit Panel').setDescription('Select the panel you wish to configure.')], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backBtn)] });
        return;
    }

    if (interaction.isStringSelectMenu() && customId === 'ticket_panel_select_action') {
        if (!await safeDefer(interaction, true)) return;
        const selectedPanelId = values[0];
        return showPanelDashboard(interaction, db, guildId, selectedPanelId);
    }

  
    async function showPanelDashboard(interaction, db, guildId, panelId, isNew = false) {
        const res = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
        if (res.rows.length === 0) return interaction.editReply({ embeds: [error('Panel not found.')] });
        const p = res.rows[0];

        const embed = new EmbedBuilder()
            .setTitle(`⚙️ Configure Panel: ${p.title}`)
            .setDescription(`**ID:** \`${p.panel_id}\`\n\nUse the buttons below to customize every aspect of this ticket panel.`)
            .addFields(
                { name: '🎨 Appearance', value: `Title: ${p.title}\nButton: ${p.button_emoji} ${p.button_label} (${p.button_style})`, inline: true },
                { name: '👥 Roles', value: `Support: ${p.support_role_id ? `<@&${p.support_role_id}>` : '`None`'}\nBlacklist: ${p.blacklist_role_id ? `<@&${p.blacklist_role_id}>` : '`None`'}`, inline: true },
                { name: '⚙️ General', value: `Category: ${p.ticket_category_id ? `<#${p.ticket_category_id}>` : '`None`'}\nLogs: ${p.log_channel_id ? `<#${p.log_channel_id}>` : '`None`'}`, inline: false }
            )
            .setColor('#2B2D31');

        if (isNew) embed.setDescription(`✅ **Panel Created!**\nNow configure the details below.\n\n**ID:** \`${p.panel_id}\``);

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tkt_embed_${panelId}`).setLabel('Embed & Msg').setStyle(ButtonStyle.Primary).setEmoji('🎨'),
            new ButtonBuilder().setCustomId(`tkt_roles_${panelId}`).setLabel('Roles').setStyle(ButtonStyle.Primary).setEmoji('👥'),
            new ButtonBuilder().setCustomId(`tkt_btn_${panelId}`).setLabel('Button Style').setStyle(ButtonStyle.Primary).setEmoji('🔘'),
            new ButtonBuilder().setCustomId(`tkt_gen_${panelId}`).setLabel('General').setStyle(ButtonStyle.Primary).setEmoji('⚙️')
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tkt_preview_${panelId}`).setLabel('Send/Preview Panel').setStyle(ButtonStyle.Success).setEmoji('📨'),
            new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Back to List').setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [embed], components: [row1, row2] });
    }

   
    if (customId === 'ticket_panel_delete_select') {
        if (!await safeDefer(interaction, true)) return;
        const panels = await db.query('SELECT panel_id, title FROM ticket_panels WHERE guild_id = $1', [guildId]);
        if (panels.rows.length === 0) return interaction.editReply({ embeds: [error('No panels to delete.')], components: []});

        const menu = new StringSelectMenuBuilder().setCustomId('ticket_panel_delete_confirm').setPlaceholder('Select panel to DELETE permanently...').addOptions(panels.rows.map(p => ({ label: p.title, value: p.panel_id, emoji: '🗑️' })));
        const backBtn = new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Cancel').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🗑️ Delete Panel').setDescription('Warning: This action cannot be undone.').setColor('#E74C3C')], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backBtn)] });
        return;
    }

    if (interaction.isStringSelectMenu() && customId === 'ticket_panel_delete_confirm') {
        if (!await safeDefer(interaction, true)) return;
        const panelId = values[0];
        await db.query('DELETE FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
        const backBtn = new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Return to Menu').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [success(`Ticket Panel \`${panelId}\` has been deleted.`)], components: [new ActionRowBuilder().addComponents(backBtn)] });
        return;
    }

    // ======================
    // 🎨 TICKET DASHBOARD: 
    // =====================

    
    if (customId.startsWith('tkt_embed_')) {
        const panelId = customId.replace('tkt_embed_', '');
        const res = await db.query('SELECT title, description, welcome_message, banner_url FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
        const p = res.rows[0];

        const modal = new ModalBuilder().setCustomId(`tkt_embed_save_${panelId}`).setTitle('Edit Panel Appearance');
        const titleInput = new TextInputBuilder().setCustomId('e_title').setLabel("Panel Title").setStyle(TextInputStyle.Short).setValue(p.title).setRequired(true).setMaxLength(256);
        const descInput = new TextInputBuilder().setCustomId('e_desc').setLabel("Panel Description").setStyle(TextInputStyle.Paragraph).setValue(p.description).setRequired(true).setMaxLength(2000);
        const welcomeInput = new TextInputBuilder().setCustomId('e_welcome').setLabel("Ticket Welcome Message").setStyle(TextInputStyle.Paragraph).setValue(p.welcome_message).setPlaceholder('Hello {user}, wait for staff...').setRequired(true).setMaxLength(1000);
        const bannerInput = new TextInputBuilder().setCustomId('e_banner').setLabel("Banner URL (Optional)").setStyle(TextInputStyle.Short).setValue(p.banner_url || '').setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(titleInput), new ActionRowBuilder().addComponents(descInput), new ActionRowBuilder().addComponents(welcomeInput), new ActionRowBuilder().addComponents(bannerInput));
        await interaction.showModal(modal);
        return;
    }

    if (customId.startsWith('tkt_embed_save_')) {
        if (!await safeDefer(interaction, true)) return;
        const panelId = customId.replace('tkt_embed_save_', '');
        await db.query(`UPDATE ticket_panels SET title = $1, description = $2, welcome_message = $3, banner_url = $4 WHERE guild_id = $5 AND panel_id = $6`, [fields.getTextInputValue('e_title'), fields.getTextInputValue('e_desc'), fields.getTextInputValue('e_welcome'), fields.getTextInputValue('e_banner') || null, guildId, panelId]);
        return showPanelDashboard(interaction, db, guildId, panelId);
    }

    // ======================
    // 2. ROLES 
    // ======================
    if (customId.startsWith('tkt_roles_')) {
        if (!await safeDefer(interaction, true)) return;
        const panelId = customId.replace('tkt_roles_', '');

        const supportMenu = new RoleSelectMenuBuilder().setCustomId(`tkt_role_support_${panelId}`).setPlaceholder('Select Support Role (Staff)').setMinValues(0).setMaxValues(1);
        const blacklistMenu = new RoleSelectMenuBuilder().setCustomId(`tkt_role_blacklist_${panelId}`).setPlaceholder('Select Blacklist Role (Banned)').setMinValues(0).setMaxValues(1);
        const dashboardBtn = new ButtonBuilder().setCustomId(`tkt_back_${panelId}`).setLabel('Back to Dashboard').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('👥 Roles Configuration').setDescription('Configure who can manage tickets and who is blocked.').setColor('#F1C40F')], components: [new ActionRowBuilder().addComponents(supportMenu), new ActionRowBuilder().addComponents(blacklistMenu), new ActionRowBuilder().addComponents(dashboardBtn)] });
        return;
    }

    if (interaction.isRoleSelectMenu() && customId.startsWith('tkt_role_')) {
        await safeDefer(interaction, true);
        const isSupport = customId.includes('_support_');
        
        const panelId = customId.replace(isSupport ? 'tkt_role_support_' : 'tkt_role_blacklist_', ''); 
        
        const roleId = values[0] || null;
        const col = isSupport ? 'support_role_id' : 'blacklist_role_id';
        await db.query(`UPDATE ticket_panels SET ${col} = $1 WHERE guild_id = $2 AND panel_id = $3`, [roleId, guildId, panelId]);
        await interaction.editReply({ content: `✅ **${isSupport ? 'Support' : 'Blacklist'} Role** updated!` });
        return showPanelDashboard(interaction, db, guildId, panelId);
    }

    // =====================
    // 3. BOTÓN 
    // ====================
    
    
    if (customId.startsWith('tkt_btn_label_')) {
        const panelId = customId.replace('tkt_btn_label_', '');
        const res = await db.query('SELECT button_label, button_emoji FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
        const p = res.rows[0];

        const modal = new ModalBuilder().setCustomId(`tkt_btn_save_text_${panelId}`).setTitle('Edit Button Text');
        const labelIn = new TextInputBuilder().setCustomId('b_label').setLabel('Button Label').setValue(p.button_label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80);
        const emojiIn = new TextInputBuilder().setCustomId('b_emoji').setLabel('Button Emoji (Paste valid emoji)').setValue(p.button_emoji).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20);

        modal.addComponents(new ActionRowBuilder().addComponents(labelIn), new ActionRowBuilder().addComponents(emojiIn));
        await interaction.showModal(modal);
        return;
    }

    if (customId.startsWith('tkt_btn_save_text_')) {
        if (!await safeDefer(interaction, true)) return;
        const panelId = customId.replace('tkt_btn_save_text_', '');
        await db.query(`UPDATE ticket_panels SET button_label = $1, button_emoji = $2 WHERE guild_id = $3 AND panel_id = $4`, [fields.getTextInputValue('b_label'), fields.getTextInputValue('b_emoji'), guildId, panelId]);
        return showPanelDashboard(interaction, db, guildId, panelId);
    }

    if (interaction.isStringSelectMenu() && customId.startsWith('tkt_btn_style_save_')) {
        await safeDefer(interaction, true);
        const panelId = customId.replace('tkt_btn_style_save_', '');
        await db.query(`UPDATE ticket_panels SET button_style = $1 WHERE guild_id = $2 AND panel_id = $3`, [values[0], guildId, panelId]);
        return showPanelDashboard(interaction, db, guildId, panelId);
    }

   
    if (customId.startsWith('tkt_btn_')) {
        if (!await safeDefer(interaction, true)) return;
        const panelId = customId.replace('tkt_btn_', '');

        const styleMenu = new StringSelectMenuBuilder().setCustomId(`tkt_btn_style_save_${panelId}`).setPlaceholder('Select Button Color/Style').addOptions([{ label: 'Primary (Blue)', value: 'Primary', emoji: '🔵' }, { label: 'Secondary (Gray)', value: 'Secondary', emoji: '🔘' }, { label: 'Success (Green)', value: 'Success', emoji: '🟢' }, { label: 'Danger (Red)', value: 'Danger', emoji: '🔴' }]);
        const editLabelBtn = new ButtonBuilder().setCustomId(`tkt_btn_label_${panelId}`).setLabel('Edit Label & Emoji').setStyle(ButtonStyle.Primary).setEmoji('📝');
        const dashboardBtn = new ButtonBuilder().setCustomId(`tkt_back_${panelId}`).setLabel('Back').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🔘 Button Configuration').setDescription('Customize how the "Open Ticket" button looks.').setColor('#5865F2')], components: [new ActionRowBuilder().addComponents(styleMenu), new ActionRowBuilder().addComponents(editLabelBtn, dashboardBtn)] });
        return;
    }

    // ============
    // 4. GENERAL
    // =============
    if (customId.startsWith('tkt_gen_') && !customId.includes('_cat_') && !customId.includes('_log_')) { // Filtro extra
        if (!await safeDefer(interaction, true)) return;
        const panelId = customId.replace('tkt_gen_', '');

        const catMenu = new ChannelSelectMenuBuilder().setCustomId(`tkt_gen_cat_${panelId}`).setPlaceholder('Select Ticket Category').setChannelTypes([ChannelType.GuildCategory]);
        const logMenu = new ChannelSelectMenuBuilder().setCustomId(`tkt_gen_log_${panelId}`).setPlaceholder('Select Log Channel').setChannelTypes([ChannelType.GuildText]);
        const dashboardBtn = new ButtonBuilder().setCustomId(`tkt_back_${panelId}`).setLabel('Back').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('⚙️ General Settings').setDescription('Set where the tickets will be created and where logs will be sent.').setColor('#95A5A6')], components: [new ActionRowBuilder().addComponents(catMenu), new ActionRowBuilder().addComponents(logMenu), new ActionRowBuilder().addComponents(dashboardBtn)] });
        return;
    }

    if (interaction.isChannelSelectMenu() && customId.startsWith('tkt_gen_')) {
        await safeDefer(interaction, true);
        const isCat = customId.includes('_cat_');

        const panelId = customId.replace(isCat ? 'tkt_gen_cat_' : 'tkt_gen_log_', '');
        
        const col = isCat ? 'ticket_category_id' : 'log_channel_id';
        await db.query(`UPDATE ticket_panels SET ${col} = $1 WHERE guild_id = $2 AND panel_id = $3`, [values[0], guildId, panelId]);
        return showPanelDashboard(interaction, db, guildId, panelId);
    }

    if (customId.startsWith('tkt_preview_')) {
        if (!await safeDefer(interaction, true)) return;
        const panelId = customId.replace('tkt_preview_', '');
        const channelMenu = new ChannelSelectMenuBuilder().setCustomId(`tkt_send_final_${panelId}`).setPlaceholder('Select channel to send the Panel').setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
        const cancelBtn = new ButtonBuilder().setCustomId(`tkt_back_${panelId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('📨 Deploy Ticket Panel').setDescription('Where do you want to send this Ticket Panel?').setColor('#2ECC71')], components: [new ActionRowBuilder().addComponents(channelMenu), new ActionRowBuilder().addComponents(cancelBtn)] });
        return;
    }

    if (customId.startsWith('tkt_send_final_')) {
        if (!await safeDefer(interaction, true)) return;
        const panelId = customId.replace('tkt_send_final_', '');
        const targetChannel = guild.channels.cache.get(values[0]);
        if (!targetChannel) return interaction.editReply({ embeds: [error("Channel not found.")] });

        const res = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
        const p = res.rows[0];

        const panelEmbed = new EmbedBuilder().setTitle(p.title).setDescription(p.description).setColor(p.button_style === 'Danger' ? 0xE74C3C : p.button_style === 'Success' ? 0x2ECC71 : 0x5865F2).setFooter({ text: 'Powered by Universal Piece System' });
        if (p.banner_url) panelEmbed.setImage(p.banner_url);

        const openBtn = new ButtonBuilder().setCustomId(`ticket_open_${panelId}`).setLabel(p.button_label).setEmoji(p.button_emoji).setStyle(ButtonStyle[p.button_style]);

        try {
            await targetChannel.send({ embeds: [panelEmbed], components: [new ActionRowBuilder().addComponents(openBtn)] });
            await interaction.editReply({ embeds: [success(`Panel **${p.title}** sent to ${targetChannel} successfully!`)], components: [] });
        } catch (err) {
            await interaction.editReply({ embeds: [error(`Failed to send panel. Check my permissions in ${targetChannel}.\nError: ${err.message}`)] });
        }
        return;
    }

    if (customId.startsWith('tkt_back_')) {
        if (!await safeDefer(interaction, true)) return;
        return showPanelDashboard(interaction, db, guildId, customId.replace('tkt_back_', ''));
    }

    // ============================
    // CONFIGURACIÓN 
    // ==========================

    if (customId === 'setup_channels') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT log_type, channel_id FROM log_channels WHERE guildid = $1", [guildId]);
        const channels = {};
        res.rows.forEach(r => channels[r.log_type] = r.channel_id);
        const formatCh = (id) => id ? `<#${id}>` : '`Not Configured`';

        const embed = new EmbedBuilder().setTitle('📜 Logging Channels Config').setDescription('Current configuration for log channels.').setColor(0x3498DB)
            .addFields({ name: '🛡️ Moderation Logs', value: formatCh(channels['modlog']), inline: true }, { name: '🔨 Ban Appeals', value: formatCh(channels['banappeal']), inline: true }, { name: '💻 Command Logs', value: formatCh(channels['cmdlog']), inline: true }, { name: '☢️ Anti-Nuke Logs', value: formatCh(channels['antinuke']), inline: true });
        
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels_edit').setLabel('Edit Channels').setStyle(ButtonStyle.Primary).setEmoji('✏️'), new ButtonBuilder().setCustomId('setup_channels_delete').setLabel('Delete').setStyle(ButtonStyle.Danger).setEmoji('🗑️'), new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ embeds: [embed], components: [row] });
        return;
    }

    if (customId === 'setup_channels_edit') {
        if (!await safeDefer(interaction, true)) return;
        const modlog = new ChannelSelectMenuBuilder().setCustomId('select_modlog_channel').setPlaceholder('Set ModLog Channel').setChannelTypes([ChannelType.GuildText]);
        const appeal = new ChannelSelectMenuBuilder().setCustomId('select_banappeal_channel').setPlaceholder('Set Ban Appeal Channel').setChannelTypes([ChannelType.GuildText]);
        const cmdlog = new ChannelSelectMenuBuilder().setCustomId('select_cmdlog_channel').setPlaceholder('Set Cmd Log Channel').setChannelTypes([ChannelType.GuildText]);
        const antinuke = new ChannelSelectMenuBuilder().setCustomId('select_antinuke_channel').setPlaceholder('Set Anti-Nuke Log Channel').setChannelTypes([ChannelType.GuildText]);
        const backButton = new ButtonBuilder().setCustomId('setup_channels').setLabel('⬅️ Back to View').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✏️ Edit Logging Channels').setDescription('Select the channels below to update configuration.')], components: [new ActionRowBuilder().addComponents(modlog), new ActionRowBuilder().addComponents(appeal), new ActionRowBuilder().addComponents(cmdlog), new ActionRowBuilder().addComponents(antinuke), new ActionRowBuilder().addComponents(backButton)] });
        return;
    }

    if (customId === 'setup_channels_delete') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT log_type FROM log_channels WHERE guildid = $1", [guildId]);
        if (res.rows.length === 0) return interaction.editReply({ embeds: [error("No channels configured to delete.")], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels').setLabel('Back').setStyle(ButtonStyle.Secondary))]});
        const options = res.rows.map(r => ({ label: `Delete ${r.log_type.toUpperCase()}`, value: r.log_type, emoji: '🗑️' }));
        const menu = new StringSelectMenuBuilder().setCustomId('select_delete_channel').setPlaceholder('Select channel to REMOVE config').addOptions(options);
        const backButton = new ButtonBuilder().setCustomId('setup_channels').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🗑️ Delete Channel Config').setDescription('Select the log type to remove from database.').setColor(0xE74C3C)], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
        return;
    }

    if (interaction.isStringSelectMenu() && customId === 'select_delete_channel') {
        await safeDefer(interaction, true);
        await db.query("DELETE FROM log_channels WHERE guildid = $1 AND log_type = $2", [guildId, values[0]]);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels').setLabel('Return to View').setStyle(ButtonStyle.Primary));
        await interaction.editReply({ embeds: [success(`Configuration for **${values[0]}** deleted.`)], components: [row] });
        return;
    }

    if (interaction.isChannelSelectMenu() && customId.endsWith('_channel')) {
        await safeDefer(interaction, true);
        const logType = customId.replace('select_', '').replace('_channel', '');
        await db.query(`INSERT INTO log_channels (guildid, log_type, channel_id) VALUES ($1, $2, $3) ON CONFLICT(guildid, log_type) DO UPDATE SET channel_id = $3`, [guildId, logType, values[0]]);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels').setLabel('Return to Channels View').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('setup_channels_edit').setLabel('Keep Editing').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ embeds: [success(`Channel for **${logType}** updated to <#${values[0]}>`)], components: [row] });
        return;
    }

    if (customId === 'setup_staff_roles') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT staff_roles FROM guild_settings WHERE guildid = $1", [guildId]);
        const roleIds = (res.rows[0]?.staff_roles || '').split(',').filter(x => x);
        const description = roleIds.length > 0 ? roleIds.map(id => `• <@&${id}>`).join('\n') : '`No Staff Roles Configured`';
        const allowedCmds = STAFF_COMMANDS.map(c => `\`${c}\``).join(', ');

        const embed = new EmbedBuilder().setTitle('🛡️ Staff Roles Config').setDescription(`Roles configured here will bypass Automod and have access to **Staff Commands**.\n\n**Current Staff Roles:**\n${description}`).addFields({ name: '✅ Granted Commands (Default)', value: allowedCmds || 'None defined in config.' }).setColor(0xF1C40F);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_staff_edit').setLabel('Edit Roles').setStyle(ButtonStyle.Primary).setEmoji('✏️'), new ButtonBuilder().setCustomId('setup_staff_delete_all').setLabel('Delete All').setStyle(ButtonStyle.Danger).setEmoji('🗑️'), new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ embeds: [embed], components: [row] });
        return;
    }

    if (customId === 'setup_staff_edit') {
        if (!await safeDefer(interaction, true)) return;
        const menu = new RoleSelectMenuBuilder().setCustomId('select_staff_roles').setPlaceholder('Add or Remove Staff Roles...').setMinValues(0).setMaxValues(25);
        const backButton = new ButtonBuilder().setCustomId('setup_staff_roles').setLabel('⬅️ Back to View').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✏️ Edit Staff Roles').setDescription('Select ALL roles that should be Staff. Unselecting a role removes it.')], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
        return;
    }

    if (customId === 'setup_staff_delete_all') {
        if (!await safeDefer(interaction, true)) return;
        await db.query("UPDATE guild_settings SET staff_roles = NULL WHERE guildid = $1", [guildId]);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_staff_roles').setLabel('Return to View').setStyle(ButtonStyle.Primary));
        await interaction.editReply({ embeds: [success(`All Staff Roles have been removed.`)], components: [row] });
        return;
    }

    if (interaction.isRoleSelectMenu() && customId === 'select_staff_roles') {
        await safeDefer(interaction, true);
        await db.query(`INSERT INTO guild_settings (guildid, staff_roles) VALUES ($1, $2) ON CONFLICT(guildid) DO UPDATE SET staff_roles = $2`, [guildId, values.join(',')]);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_staff_roles').setLabel('Return to Staff View').setStyle(ButtonStyle.Primary));
        await interaction.editReply({ embeds: [success(`Staff Roles updated successfully. (${values.length} roles active)`)], components: [row] });
        return;
    }

    if (customId === 'setup_permissions') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT command_name, role_id FROM command_permissions WHERE guildid = $1 ORDER BY command_name", [guildId]);
        const perms = {};
        res.rows.forEach(r => { if (!perms[r.command_name]) perms[r.command_name] = []; perms[r.command_name].push(r.role_id); });
        let description = Object.keys(perms).length === 0 ? '`No specific command permissions configured.`' : Object.entries(perms).map(([cmd, roles]) => `**/${cmd}**: ${roles.map(r => `<@&${r}>`).join(', ')}`).join('\n');
        
        const embed = new EmbedBuilder().setTitle('🔐 Command Permissions Config').setDescription(`Specific role overrides for commands (Bypass defaults & Lockdown).\n\n${description}`).setColor(0xE74C3C);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_perms_edit_select').setLabel('Add/Edit Override').setStyle(ButtonStyle.Primary).setEmoji('✏️'), new ButtonBuilder().setCustomId('setup_perms_delete').setLabel('Delete').setStyle(ButtonStyle.Danger).setEmoji('🗑️'), new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ embeds: [embed], components: [row] });
        return;
    }

    if (customId === 'setup_perms_edit_select') {
        if (!await safeDefer(interaction, true)) return;
        const commands = client.commands.filter(c => c.data.name !== 'setup').map(c => ({ label: `/${c.data.name}`, value: c.data.name })).slice(0, 25);
        const menu = new StringSelectMenuBuilder().setCustomId('select_command_perms').setPlaceholder('Select command to edit...').addOptions(commands);
        const backButton = new ButtonBuilder().setCustomId('setup_permissions').setLabel('⬅️ Back to View').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✏️ Select Command').setDescription('Which command do you want to modify permissions for?')], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
        return;
    }

    if (customId === 'setup_perms_delete') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT DISTINCT command_name FROM command_permissions WHERE guildid = $1", [guildId]);
        if (res.rows.length === 0) return interaction.editReply({ embeds: [error("No custom permissions configured to delete.")], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_permissions').setLabel('Back').setStyle(ButtonStyle.Secondary))]});
        const options = res.rows.map(r => ({ label: `Reset /${r.command_name}`, value: r.command_name, emoji: '🗑️' })).slice(0, 25);
        const menu = new StringSelectMenuBuilder().setCustomId('select_delete_perm').setPlaceholder('Select command to RESET').addOptions(options);
        const backButton = new ButtonBuilder().setCustomId('setup_permissions').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🗑️ Delete Permission Config').setDescription('Select the command to remove all overrides (Reset to default).').setColor(0xE74C3C)], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
        return;
    }

    if (interaction.isStringSelectMenu() && customId === 'select_delete_perm') {
        await safeDefer(interaction, true);
        await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, values[0]]);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_permissions').setLabel('Return to View').setStyle(ButtonStyle.Primary));
        await interaction.editReply({ embeds: [success(`Permissions for **/${values[0]}** have been reset to default.`)], components: [row] });
        return;
    }

    if (interaction.isStringSelectMenu() && customId === 'select_command_perms') {
        await safeDefer(interaction, true);
        const cmdName = values[0];
        const res = await db.query("SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
        const currentRoles = res.rows.map(r => `<@&${r.role_id}>`).join(', ') || 'None';
        const menu = new RoleSelectMenuBuilder().setCustomId(`perms_role_select_${cmdName}`).setPlaceholder(`Allowed roles for /${cmdName}`).setMinValues(0).setMaxValues(25);
        const backButton = new ButtonBuilder().setCustomId('setup_perms_edit_select').setLabel('⬅️ Back to Commands').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`🔐 Permissions for /${cmdName}`).setDescription(`Current Allowed Roles: ${currentRoles}\n\n**Select NEW list of allowed roles.**\n(Leave empty to remove all overrides)`)], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
        return;
    }

    if (interaction.isRoleSelectMenu() && customId.startsWith('perms_role_select_')) {
        await safeDefer(interaction, true);
        const cmdName = customId.replace('perms_role_select_', '');
        await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
        for (const rId of values) { await db.query("INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, $2, $3)", [guildId, cmdName, rId]); }
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_permissions').setLabel('Return to Permissions View').setStyle(ButtonStyle.Primary));
        await interaction.editReply({ embeds: [success(`Permissions for **/${cmdName}** updated.`)], components: [row] });
        return;
    }

    if (customId === 'setup_back_to_main' && generateSetupContent) {
        if (!await safeDefer(interaction, true)) return;
        const { embed, components } = await generateSetupContent(interaction, guildId);
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

    if (customId === 'cancel_setup') {
        await interaction.deferUpdate(); 
        await interaction.deleteReply().catch(() => {});
        return;
    }

    if (customId === 'setup_antinuke') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1", [guildId]);
        const isEnabled = res.rows[0]?.antinuke_enabled || false;
        const embed = new EmbedBuilder().setTitle('🛡️ Anti-Nuke System').setDescription(`The Anti-Nuke system automatically backups the server state (Roles, Channels) daily and allows restoration.\n\n**Status:** ${isEnabled ? '✅ ENABLED' : '❌ DISABLED'}`).setColor(isEnabled ? 0x2ECC71 : 0xE74C3C);
        const toggleBtn = new ButtonBuilder().setCustomId('antinuke_toggle').setLabel(isEnabled ? 'Disable System' : 'Enable System').setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success);
        const backBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(toggleBtn, backBtn)] });
        return;
    }

    if (customId === 'antinuke_toggle') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1", [guildId]);
        const newState = !(res.rows[0]?.antinuke_enabled || false);
        await db.query(`INSERT INTO guild_backups (guildid, antinuke_enabled) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET antinuke_enabled = $2`, [guildId, newState]);
        const embed = new EmbedBuilder().setTitle('🛡️ Anti-Nuke System').setDescription(`**Status:** ${newState ? '✅ ENABLED' : '❌ DISABLED'}`).setColor(newState ? 0x2ECC71 : 0xE74C3C);
        const toggleBtn = new ButtonBuilder().setCustomId('antinuke_toggle').setLabel(newState ? 'Disable System' : 'Enable System').setStyle(newState ? ButtonStyle.Danger : ButtonStyle.Success);
        const backBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(toggleBtn, backBtn)] });
        return;
    }

    if (customId === 'delete_all_data') {
        if (!await safeDefer(interaction, false, true)) return; 
        const confirmBtn = new ButtonBuilder().setCustomId('confirm_delete_data').setLabel('CONFIRM DELETION').setStyle(ButtonStyle.Danger);
        const cancelBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [error('⚠️ **DANGER ZONE** ⚠️\nThis will delete ALL configuration, logs, rules and appeals for this server.\nThis action cannot be undone.')], components: [new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)] });
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
        await db.query("DELETE FROM ticket_panels WHERE guild_id = $1", [guildId]);
        await db.query("DELETE FROM tickets WHERE guild_id = $1", [guildId]);

        await interaction.editReply({ embeds: [success('All data for this guild has been wiped from the database.')], components: [] });
        return;
    }
};