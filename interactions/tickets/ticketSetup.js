const { 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, 
    RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType, ModalBuilder, 
    TextInputBuilder, TextInputStyle 
} = require('discord.js');
const { safeDefer, smartReply } = require('../../utils/interactionHelpers.js');
const { success, error } = require('../../utils/embedFactory.js');


const multiPanelSelectionCache = new Map();

async function showPanelDashboard(interaction, db, guildId, panelId) {
    const res = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
    if (res.rows.length === 0) return await smartReply(interaction, { embeds: [error('Panel not found in database.')] });
    const p = res.rows[0];

    const embed = new EmbedBuilder()
        .setTitle(`⚙️ Configuration: ${p.title}`)
        .setDescription(`Current settings for panel \`${p.panel_id}\`.\nUse the buttons below to modify the configuration.`)
        .addFields(
            { name: '🎨 Appearance', value: `> **Title:** ${p.title}\n> **Color:** \`${p.panel_color || '#5865F2'}\`\n> **Button:** ${p.button_emoji || '🎫'} ${p.button_label || 'Open'}`, inline: true },
            { name: '👥 Roles', value: `> **Support:** ${p.support_role_id ? `<@&${p.support_role_id}>` : '`Not Set`'}\n> **Blacklist:** ${p.blacklist_role_id ? `<@&${p.blacklist_role_id}>` : '`Not Set`'}`, inline: true },
            { name: '⚙️ General', value: `> **Category:** ${p.ticket_category_id ? `<#${p.ticket_category_id}>` : '`Not Set`'}\n> **Logs:** ${p.log_channel_id ? `<#${p.log_channel_id}>` : '`Not Set`'}\n> **Limit:** \`${p.ticket_limit || 1} per user\``, inline: false }
        )
        .setColor(p.panel_color || '#5865F2')
        .setFooter({ text: 'Made by Ukirama' });

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tkt_appearance_menu_${panelId}`).setLabel('Appearance').setStyle(ButtonStyle.Primary).setEmoji('🎨'),
        new ButtonBuilder().setCustomId(`tkt_roles_menu_${panelId}`).setLabel('Roles').setStyle(ButtonStyle.Primary).setEmoji('👥'),
        new ButtonBuilder().setCustomId(`tkt_gen_${panelId}`).setLabel('General').setStyle(ButtonStyle.Primary).setEmoji('⚙️')
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tkt_preview_${panelId}`).setLabel('Post Panel').setStyle(ButtonStyle.Success).setEmoji('📨'),
        new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Back to Menu').setStyle(ButtonStyle.Secondary).setEmoji('⬅️')
    );

    await smartReply(interaction, { content: null, embeds: [embed], components: [row1, row2] });
}

async function showAppearanceMenu(interaction, db, guildId, panelId) {
    const res = await db.query('SELECT title, description, welcome_message, button_label, button_emoji, panel_color, welcome_color, button_style FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
    const p = res.rows[0];

    const panelPreview = new EmbedBuilder()
        .setTitle(p.title)
        .setDescription(p.description || '*(No description set)*')
        .setColor(p.panel_color || '#5865F2')
        .setFooter({ text: 'Preview: Main Panel Embed' });

    const welcomePreview = new EmbedBuilder()
        .setDescription(`**Welcome Message Preview:**\n${p.welcome_message || 'Hello {user}...'}`)
        .setColor(p.welcome_color || '#5865F2')
        .setFooter({ text: 'Preview: Ticket Welcome Message' });

    const rowEmbeds = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tkt_edit_panel_embed_${panelId}`).setLabel('Edit Panel Embed').setStyle(ButtonStyle.Primary).setEmoji('🖼️'),
        new ButtonBuilder().setCustomId(`tkt_edit_welcome_msg_${panelId}`).setLabel('Edit Welcome Msg').setStyle(ButtonStyle.Primary).setEmoji('👋'),
        new ButtonBuilder().setCustomId(`tkt_select_color_target_${panelId}`).setLabel('Change Colors').setStyle(ButtonStyle.Success).setEmoji('🎨')
    );

    const rowButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tkt_edit_button_${panelId}`).setLabel(`Button: ${p.button_emoji} ${p.button_label}`).setStyle(ButtonStyle.Secondary).setEmoji('🔘'),
        new ButtonBuilder().setCustomId(`tkt_back_${panelId}`).setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji('⬅️')
    );

    await smartReply(interaction, { 
        content: `**🎨 Appearance Settings for \`${panelId}\`**`,
        embeds: [panelPreview, welcomePreview], 
        components: [rowEmbeds, rowButtons] 
    });
}

async function showColorTargetSelector(interaction, panelId) {
    const embed = new EmbedBuilder()
        .setTitle('🎨 Color Configuration')
        .setDescription('**Which element do you want to customize?**\n\n> 🖼️ **Panel Embed:** The main message where users click to open tickets.\n> 👋 **Welcome Embed:** The message sent inside the new ticket.\n> 🔘 **Button Style:** The color of the "Open Ticket" button.')
        .setColor('#2B2D31');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tkt_color_source_panel_${panelId}`).setLabel('Panel Embed').setStyle(ButtonStyle.Primary).setEmoji('🖼️'),
        new ButtonBuilder().setCustomId(`tkt_color_source_welcome_${panelId}`).setLabel('Welcome Embed').setStyle(ButtonStyle.Primary).setEmoji('👋'),
        new ButtonBuilder().setCustomId(`tkt_color_source_button_${panelId}`).setLabel('Button Style').setStyle(ButtonStyle.Secondary).setEmoji('🔘')
    );

    const rowBack = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tkt_appearance_menu_${panelId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
    );

    await smartReply(interaction, { content: null, embeds: [embed], components: [row, rowBack] });
}

async function showHexPicker(interaction, panelId, targetSource) {
    const targetName = targetSource === 'panel' ? 'Panel Embed' : 'Welcome Embed';
    const embed = new EmbedBuilder().setTitle(`🎨 Select Color for: ${targetName}`).setDescription('Choose a standard color or enter a custom HEX code.').setColor('#2B2D31');

    const rowStandard = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tkt_set_hex_Blue_${targetSource}_${panelId}`).setLabel('Blue').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`tkt_set_hex_Red_${targetSource}_${panelId}`).setLabel('Red').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`tkt_set_hex_Green_${targetSource}_${panelId}`).setLabel('Green').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`tkt_set_hex_Grey_${targetSource}_${panelId}`).setLabel('Grey').setStyle(ButtonStyle.Secondary)
    );

    const rowCustom = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tkt_set_hex_custom_${targetSource}_${panelId}`).setLabel('Custom HEX').setStyle(ButtonStyle.Secondary).setEmoji('#️⃣'),
        new ButtonBuilder().setCustomId(`tkt_select_color_target_${panelId}`).setLabel('Back').setStyle(ButtonStyle.Secondary)
    );

    await smartReply(interaction, { content: null, embeds: [embed], components: [rowStandard, rowCustom] });
}

async function showButtonStylePicker(interaction, panelId) {
    const embed = new EmbedBuilder().setTitle('🔘 Select Button Style').setDescription('Discord buttons have 4 fixed styles. Choose one:').setColor('#2B2D31');
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tkt_set_btn_Primary_${panelId}`).setLabel('Blurple (Primary)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`tkt_set_btn_Success_${panelId}`).setLabel('Green (Success)').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`tkt_set_btn_Danger_${panelId}`).setLabel('Red (Danger)').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`tkt_set_btn_Secondary_${panelId}`).setLabel('Grey (Secondary)').setStyle(ButtonStyle.Secondary)
    );
    const rowBack = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tkt_select_color_target_${panelId}`).setLabel('Back').setStyle(ButtonStyle.Secondary));
    await smartReply(interaction, { content: null, embeds: [embed], components: [row, rowBack] });
}


module.exports = async (interaction) => {
    const { customId, guild, client, values, fields, user } = interaction;
    const db = client.db;
    const guildId = guild.id;

    if (customId === 'setup_tickets_menu') {
        if (!await safeDefer(interaction, true)) return;
        const panels = await db.query('SELECT panel_id, title FROM ticket_panels WHERE guild_id = $1 ORDER BY id ASC', [guildId]);
        const panelList = panels.rows.length > 0 ? panels.rows.map(p => `• **${p.title}** (ID: \`${p.panel_id}\`)`).join('\n') : '_No panels created yet._';
        const embed = new EmbedBuilder().setTitle('🎫 Ticket System').setDescription(`Manage your panels.\n\n**Current Panels:**\n${panelList}`).setColor('#5865F2').setFooter({ text: 'Made by Ukirama' });
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket_panel_create').setLabel('Create Panel').setStyle(ButtonStyle.Success).setEmoji('➕'),
            new ButtonBuilder().setCustomId('ticket_multipanel_create').setLabel('Create Multipanel').setStyle(ButtonStyle.Secondary).setEmoji('📑').setDisabled(panels.rows.length < 2), // Solo activado si hay 2 o mas
            new ButtonBuilder().setCustomId('tkt_edit_list').setLabel('Edit').setStyle(ButtonStyle.Primary).setEmoji('✏️').setDisabled(panels.rows.length === 0),
            new ButtonBuilder().setCustomId('tkt_delete_list').setLabel('Delete').setStyle(ButtonStyle.Danger).setEmoji('🗑️').setDisabled(panels.rows.length === 0),
            new ButtonBuilder().setCustomId('setup_home').setLabel('Back').setStyle(ButtonStyle.Secondary)
        );
        return await smartReply(interaction, { content: null, embeds: [embed], components: [row] });
    }


    if (customId === 'ticket_multipanel_create') {
        if (!await safeDefer(interaction, true)) return;
        const panels = await db.query('SELECT panel_id, title FROM ticket_panels WHERE guild_id = $1 ORDER BY id ASC', [guildId]);
        
        if (panels.rows.length < 2) {
             return await smartReply(interaction, { embeds: [error('You need at least 2 panels to create a Multipanel.')] });
        }

        const menu = new StringSelectMenuBuilder()
            .setCustomId('tkt_multi_select_panels')
            .setPlaceholder('Select panels to include (Max 10)')
            .setMinValues(2)
            .setMaxValues(Math.min(panels.rows.length, 10)) 
            .addOptions(panels.rows.map(p => ({ label: p.title, value: p.panel_id, emoji: '🎫' })));

        const embed = new EmbedBuilder()
            .setTitle('📑 Create Multipanel')
            .setDescription('Select the individual panels you want to combine into one message.\nWait until you select them to choose the destination channel.')
            .setColor('#5865F2');

        const row = new ActionRowBuilder().addComponents(menu);
        const rowBack = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Cancel').setStyle(ButtonStyle.Secondary));

        return await smartReply(interaction, { content: null, embeds: [embed], components: [row, rowBack] });
    }

    if (customId === 'tkt_multi_select_panels') {
        if (!await safeDefer(interaction, true)) return;
        
        multiPanelSelectionCache.set(user.id, values);

        const channelMenu = new ChannelSelectMenuBuilder()
            .setCustomId('tkt_multi_deploy_final')
            .setPlaceholder('Select destination channel...')
            .addChannelTypes(ChannelType.GuildText);

        const embed = new EmbedBuilder()
            .setTitle('📑 Create Multipanel')
            .setDescription(`**${values.length} Panels Selected.**\nNow select the channel where you want to send the Multipanel.`)
            .setColor('#2ECC71');

        const row = new ActionRowBuilder().addComponents(channelMenu);
        const rowBack = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Cancel').setStyle(ButtonStyle.Secondary));

        return await smartReply(interaction, { content: null, embeds: [embed], components: [row, rowBack] });
    }

    if (interaction.isChannelSelectMenu() && customId === 'tkt_multi_deploy_final') {
        if (!await safeDefer(interaction, true)) return;

        const selectedPanels = multiPanelSelectionCache.get(user.id);
        if (!selectedPanels) return await smartReply(interaction, { embeds: [error('Session expired or invalid selection. Please try again.')] });

        const res = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 AND panel_id = ANY($2)', [guildId, selectedPanels]);
        
        const orderedPanels = selectedPanels.map(id => res.rows.find(row => row.panel_id === id)).filter(Boolean);

        const targetChannel = guild.channels.cache.get(values[0]);
        if (!targetChannel) return await smartReply(interaction, { embeds: [error('Invalid channel.')] });

        const embedsArray = orderedPanels.map(p => 
            new EmbedBuilder()
                .setTitle(p.title)
                .setDescription(p.description)
                .setColor(p.panel_color || '#5865F2')
        );
        embedsArray[embedsArray.length - 1].setFooter({ text: 'Made by Ukirama' });

        const buttonsArray = orderedPanels.map(p => 
            new ButtonBuilder()
                .setCustomId(`ticket_open_${p.panel_id}`)
                .setLabel(p.button_label)
                .setStyle(ButtonStyle[p.button_style] || ButtonStyle.Primary)
                .setEmoji(p.button_emoji)
        );

     
        const componentRows = [];
        for (let i = 0; i < buttonsArray.length; i += 5) {
            const row = new ActionRowBuilder().addComponents(buttonsArray.slice(i, i + 5));
            componentRows.push(row);
        }

        try {
            await targetChannel.send({ embeds: embedsArray, components: componentRows });
            multiPanelSelectionCache.delete(user.id); 
            return await smartReply(interaction, { content: null, embeds: [success(`**Multipanel** sent successfully to <#${targetChannel.id}> with **${orderedPanels.length}** panels.`)] });
        } catch (err) {
            console.error(err);
            return await smartReply(interaction, { embeds: [error('Failed to send Multipanel. Check my permissions in that channel.')] });
        }
    }

   

    if (customId === 'tkt_edit_list' || customId === 'tkt_delete_list') {
        if (!await safeDefer(interaction, true)) return;
        const isDelete = customId.includes('delete');
        const panels = await db.query('SELECT panel_id, title FROM ticket_panels WHERE guild_id = $1', [guildId]);
        const menu = new StringSelectMenuBuilder().setCustomId(isDelete ? 'tkt_confirm_delete' : 'tkt_select_dashboard').setPlaceholder('Select panel...').addOptions(panels.rows.map(p => ({ label: p.title, value: p.panel_id, emoji: isDelete ? '🗑️' : '✏️' })));
        return await smartReply(interaction, { content: null, embeds: [new EmbedBuilder().setTitle(isDelete ? '🗑️ Delete' : '✏️ Edit').setDescription('Select a panel.').setColor(isDelete ? '#E74C3C' : '#3498DB')], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Cancel').setStyle(ButtonStyle.Secondary))] });
    }
    if (customId === 'tkt_select_dashboard') { if (!await safeDefer(interaction, true)) return; return showPanelDashboard(interaction, db, guildId, values[0]); }
    if (customId === 'tkt_confirm_delete') { 
        if (!await safeDefer(interaction, true)) return; 
        await db.query('DELETE FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, values[0]]); 
        return await smartReply(interaction, { content: null, embeds: [success(`Panel \`${values[0]}\` deleted.`)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Return').setStyle(ButtonStyle.Primary))] }); 
    }

    if (customId.startsWith('tkt_appearance_menu_')) {
        if (!await safeDefer(interaction, true)) return;
        return await showAppearanceMenu(interaction, db, guildId, customId.replace('tkt_appearance_menu_', ''));
    }

    if (customId.startsWith('tkt_select_color_target_')) {
        if (!await safeDefer(interaction, true)) return;
        return await showColorTargetSelector(interaction, customId.replace('tkt_select_color_target_', ''));
    }

    if (customId.startsWith('tkt_color_source_')) {
        if (!await safeDefer(interaction, true)) return;
        const parts = customId.split('_');
        const type = parts[3];
        const pId = parts[4];
        if (type === 'button') return await showButtonStylePicker(interaction, pId);
        else return await showHexPicker(interaction, pId, type);
    }

    if (customId.startsWith('tkt_set_hex_') && !customId.includes('custom')) {
        if (!await safeDefer(interaction, true)) return;
        const parts = customId.split('_');
        const colorName = parts[3];
        const target = parts[4];
        const pId = parts[5];
        const colorMap = { 'Blue': '#3498DB', 'Red': '#E74C3C', 'Green': '#2ECC71', 'Grey': '#95A5A6' };
        const colName = target === 'panel' ? 'panel_color' : 'welcome_color';
        await db.query(`UPDATE ticket_panels SET ${colName} = $1 WHERE guild_id = $2 AND panel_id = $3`, [colorMap[colorName], guildId, pId]);
        return await showAppearanceMenu(interaction, db, guildId, pId);
    }

    if (customId.startsWith('tkt_set_btn_')) {
        if (!await safeDefer(interaction, true)) return;
        const parts = customId.split('_');
        const style = parts[3];
        const pId = parts[4];
        await db.query(`UPDATE ticket_panels SET button_style = $1 WHERE guild_id = $2 AND panel_id = $3`, [style, guildId, pId]);
        return await showAppearanceMenu(interaction, db, guildId, pId);
    }

    if (customId.startsWith('tkt_set_hex_custom_')) {
        const parts = customId.split('_');
        const target = parts[4];
        const pId = parts[5];
        const modal = new ModalBuilder().setCustomId(`tkt_save_hex_final_${target}_${pId}`).setTitle('Custom HEX Color');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('hex').setLabel("HEX Code").setStyle(TextInputStyle.Short).setPlaceholder('#FFFFFF').setRequired(true).setMaxLength(7)));
        return await interaction.showModal(modal);
    }

    if (customId.startsWith('tkt_save_hex_final_')) {
        if (!await safeDefer(interaction, true)) return;
        const parts = customId.split('_');
        const target = parts[4];
        const pId = parts[5];
        let hex = fields.getTextInputValue('hex');
        if (!hex.startsWith('#')) hex = '#' + hex;
        if (!/^#([0-9A-F]{3}){1,2}$/i.test(hex)) return await smartReply(interaction, { embeds: [error('Invalid HEX code.')] }, true);
        const colName = target === 'panel' ? 'panel_color' : 'welcome_color';
        await db.query(`UPDATE ticket_panels SET ${colName} = $1 WHERE guild_id = $2 AND panel_id = $3`, [hex, guildId, pId]);
        return await showAppearanceMenu(interaction, db, guildId, pId);
    }

    if (customId.startsWith('tkt_edit_panel_embed_')) {
        const pId = customId.replace('tkt_edit_panel_embed_', '');
        const res = await db.query('SELECT title, description FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, pId]);
        const p = res.rows[0];
        const modal = new ModalBuilder().setCustomId(`tkt_save_panel_embed_${pId}`).setTitle('Edit Main Panel');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel("Title").setStyle(TextInputStyle.Short).setValue(p.title).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel("Description").setStyle(TextInputStyle.Paragraph).setValue(p.description || '').setRequired(true)));
        return await interaction.showModal(modal);
    }

    if (customId.startsWith('tkt_save_panel_embed_')) {
        if (!await safeDefer(interaction, true)) return;
        const pId = customId.replace('tkt_save_panel_embed_', '');
        await db.query('UPDATE ticket_panels SET title = $1, description = $2 WHERE guild_id = $3 AND panel_id = $4', [fields.getTextInputValue('title'), fields.getTextInputValue('desc'), guildId, pId]);
        return showAppearanceMenu(interaction, db, guildId, pId);
    }

    if (customId.startsWith('tkt_edit_welcome_msg_')) {
        const pId = customId.replace('tkt_edit_welcome_msg_', '');
        const res = await db.query('SELECT welcome_message FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, pId]);
        const modal = new ModalBuilder().setCustomId(`tkt_save_welcome_${pId}`).setTitle('Edit Welcome Msg');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('welcome').setLabel("Message").setStyle(TextInputStyle.Paragraph).setValue(res.rows[0].welcome_message || '').setRequired(true)));
        return await interaction.showModal(modal);
    }

    if (customId.startsWith('tkt_save_welcome_')) {
        if (!await safeDefer(interaction, true)) return;
        const pId = customId.replace('tkt_save_welcome_', '');
        await db.query('UPDATE ticket_panels SET welcome_message = $1 WHERE guild_id = $2 AND panel_id = $3', [fields.getTextInputValue('welcome'), guildId, pId]);
        return showAppearanceMenu(interaction, db, guildId, pId);
    }

    if (customId.startsWith('tkt_edit_button_')) {
        const pId = customId.replace('tkt_edit_button_', '');
        const res = await db.query('SELECT button_label, button_emoji FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, pId]);
        const modal = new ModalBuilder().setCustomId(`tkt_save_button_txt_${pId}`).setTitle('Edit Button Text');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('label').setLabel("Label").setStyle(TextInputStyle.Short).setValue(res.rows[0].button_label || 'Open').setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel("Emoji").setStyle(TextInputStyle.Short).setValue(res.rows[0].button_emoji || '🎫').setRequired(true)));
        return await interaction.showModal(modal);
    }

    if (customId.startsWith('tkt_save_button_txt_')) {
        const pId = customId.replace('tkt_save_button_txt_', '');
        const label = fields.getTextInputValue('label').trim();
        const emoji = fields.getTextInputValue('emoji').trim();
        
        if (!label) return await smartReply(interaction, { embeds: [error('Button label cannot be empty.')] }, true);
        if (label.length > 80) return await smartReply(interaction, { embeds: [error('Button label must be 80 characters or less.')] }, true);
        if (emoji && !/(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|<a?:\w+:\d+>)/g.test(emoji)) return await smartReply(interaction, { embeds: [error('Invalid Emoji.')] }, true);
        
        if (!await safeDefer(interaction, true)) return;
        await db.query(`UPDATE ticket_panels SET button_label = $1, button_emoji = $2 WHERE guild_id = $3 AND panel_id = $4`, [label, emoji || '📩', guildId, pId]);
        return showAppearanceMenu(interaction, db, guildId, pId);
    }

    if (customId.startsWith('tkt_roles_menu_')) { 
        if (!await safeDefer(interaction, true)) return;
        const pId = customId.replace('tkt_roles_menu_', '');
        const res = await db.query('SELECT support_role_id, blacklist_role_id FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, pId]);
        const p = res.rows[0];
        const embed = new EmbedBuilder().setTitle('👥 Roles').setDescription(`Config for **${pId}**\n\n> **Support:** ${p.support_role_id ? `<@&${p.support_role_id}>` : '`Not Set`'}\n> **Blacklist:** ${p.blacklist_role_id ? `<@&${p.blacklist_role_id}>` : '`Not Set`'}`).setColor('#F1C40F').setFooter({ text: 'Made by Ukirama' });
        const r1 = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`tkt_save_role_support_${pId}`).setPlaceholder('Select Support Role'));
        const r2 = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`tkt_save_role_blacklist_${pId}`).setPlaceholder('Select Blacklist Role'));
        const r3 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tkt_back_${pId}`).setLabel('Back').setStyle(ButtonStyle.Secondary));
        return await smartReply(interaction, { content: null, embeds: [embed], components: [r1, r2, r3] });
    }
    
    if (interaction.isRoleSelectMenu() && customId.startsWith('tkt_save_role_')) {
        if (!await safeDefer(interaction, true)) return;
        const isSupport = customId.includes('support');
        const pId = customId.split('_')[4];
        const col = isSupport ? 'support_role_id' : 'blacklist_role_id';
        await db.query(`UPDATE ticket_panels SET ${col} = $1 WHERE guild_id = $2 AND panel_id = $3`, [values[0], guildId, pId]);
        const res = await db.query('SELECT support_role_id, blacklist_role_id FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, pId]);
        const p = res.rows[0];
        const embed = new EmbedBuilder().setTitle('👥 Roles').setDescription(`Config for **${pId}**\n\n> **Support:** ${p.support_role_id ? `<@&${p.support_role_id}>` : '`Not Set`'}\n> **Blacklist:** ${p.blacklist_role_id ? `<@&${p.blacklist_role_id}>` : '`Not Set`'}`).setColor('#F1C40F').setFooter({ text: 'Made by Ukirama' });
        const r1 = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`tkt_save_role_support_${pId}`).setPlaceholder('Select Support Role'));
        const r2 = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`tkt_save_role_blacklist_${pId}`).setPlaceholder('Select Blacklist Role'));
        const r3 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tkt_back_${pId}`).setLabel('Back').setStyle(ButtonStyle.Secondary));
        return await smartReply(interaction, { content: null, embeds: [embed], components: [r1, r2, r3] });
    }

    if (customId.startsWith('tkt_gen_')) { 
        if (!await safeDefer(interaction, true)) return;
        const pId = customId.replace('tkt_gen_', '');
        const res = await db.query('SELECT ticket_category_id, log_channel_id, ticket_limit FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, pId]);
        const p = res.rows[0];
        
        const embed = new EmbedBuilder()
            .setTitle('⚙️ General')
            .setDescription(`Config for **${pId}**\n\n> **Category:** ${p.ticket_category_id ? `<#${p.ticket_category_id}>` : '`Not Set`'}\n> **Logs:** ${p.log_channel_id ? `<#${p.log_channel_id}>` : '`Not Set`'}\n> **Limit:** \`${p.ticket_limit || 1}\` tickets per user`)
            .setColor('#95A5A6')
            .setFooter({ text: 'Made by Ukirama' });

        const c1 = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(`tkt_save_cat_${pId}`).setPlaceholder('Select Category').addChannelTypes(ChannelType.GuildCategory));
        const c2 = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(`tkt_save_log_${pId}`).setPlaceholder('Select Log Channel').addChannelTypes(ChannelType.GuildText));
        
        const c3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tkt_edit_limit_${pId}`).setLabel('Set Limit').setStyle(ButtonStyle.Primary).setEmoji('🔢'),
            new ButtonBuilder().setCustomId(`tkt_back_${pId}`).setLabel('Back').setStyle(ButtonStyle.Secondary)
        );

        return await smartReply(interaction, { content: null, embeds: [embed], components: [c1, c2, c3] });
    }

    if (interaction.isChannelSelectMenu() && (customId.startsWith('tkt_save_cat_') || customId.startsWith('tkt_save_log_'))) {
        if (!await safeDefer(interaction, true)) return;
        const isCat = customId.includes('cat');
        const pId = customId.split('_')[3];
        const col = isCat ? 'ticket_category_id' : 'log_channel_id';
        await db.query(`UPDATE ticket_panels SET ${col} = $1 WHERE guild_id = $2 AND panel_id = $3`, [values[0], guildId, pId]);
        
        const res = await db.query('SELECT ticket_category_id, log_channel_id, ticket_limit FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, pId]);
        const p = res.rows[0];
        const embed = new EmbedBuilder().setTitle('⚙️ General').setDescription(`Config for **${pId}**\n\n> **Category:** ${p.ticket_category_id ? `<#${p.ticket_category_id}>` : '`Not Set`'}\n> **Logs:** ${p.log_channel_id ? `<#${p.log_channel_id}>` : '`Not Set`'}\n> **Limit:** \`${p.ticket_limit || 1}\` tickets per user`).setColor('#95A5A6').setFooter({ text: 'Made by Ukirama' });
        const c1 = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(`tkt_save_cat_${pId}`).setPlaceholder('Select Category').addChannelTypes(ChannelType.GuildCategory));
        const c2 = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(`tkt_save_log_${pId}`).setPlaceholder('Select Log Channel').addChannelTypes(ChannelType.GuildText));
        const c3 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tkt_edit_limit_${pId}`).setLabel('Set Limit').setStyle(ButtonStyle.Primary).setEmoji('🔢'), new ButtonBuilder().setCustomId(`tkt_back_${pId}`).setLabel('Back').setStyle(ButtonStyle.Secondary));
        
        return await smartReply(interaction, { content: null, embeds: [embed], components: [c1, c2, c3] });
    }

    if (customId.startsWith('tkt_edit_limit_')) {
        const pId = customId.replace('tkt_edit_limit_', '');
        const modal = new ModalBuilder().setCustomId(`tkt_save_limit_${pId}`).setTitle('Ticket Limit');
        const input = new TextInputBuilder()
            .setCustomId('limit_input')
            .setLabel("Max tickets per user")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Example: 1')
            .setRequired(true)
            .setMaxLength(2);
        
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return await interaction.showModal(modal);
    }

    if (customId.startsWith('tkt_save_limit_')) {
        if (!await safeDefer(interaction, true)) return;
        const pId = customId.replace('tkt_save_limit_', '');
        const limitVal = parseInt(fields.getTextInputValue('limit_input'));

        if (isNaN(limitVal) || limitVal < 1 || limitVal > 100) {
            return await smartReply(interaction, { embeds: [error('Ticket limit must be a number between 1 and 100.')] }, true);
        }

        await db.query('UPDATE ticket_panels SET ticket_limit = $1 WHERE guild_id = $2 AND panel_id = $3', [limitVal, guildId, pId]);
        
        
        interaction.customId = `tkt_gen_${pId}`;
        return module.exports(interaction); 
    }

    if (customId.startsWith('tkt_back_')) { if (!await safeDefer(interaction, true)) return; return showPanelDashboard(interaction, db, guildId, customId.replace('tkt_back_', '')); }
    if (customId === 'ticket_panel_create') { const modal = new ModalBuilder().setCustomId('ticket_panel_create_modal').setTitle('New Panel'); modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('panel_unique_id').setLabel("Internal ID").setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('panel_title').setLabel("Title").setStyle(TextInputStyle.Short).setRequired(true))); return await interaction.showModal(modal); }
    if (customId === 'ticket_panel_create_modal') { 
        if (!await safeDefer(interaction, true)) return; 
        const rawPId = fields.getTextInputValue('panel_unique_id').trim();
        const title = fields.getTextInputValue('panel_title').trim();
        
        if (!rawPId) return await smartReply(interaction, { embeds: [error('Panel ID cannot be empty.')] }, true);
        if (rawPId.length > 50) return await smartReply(interaction, { embeds: [error('Panel ID must be 50 characters or less.')] }, true);
        if (!/^[a-z0-9-_]+$/.test(rawPId.toLowerCase())) return await smartReply(interaction, { embeds: [error('Panel ID must contain only letters, numbers, hyphens, and underscores.')] }, true);
        
        if (!title) return await smartReply(interaction, { embeds: [error('Panel title cannot be empty.')] }, true);
        if (title.length > 100) return await smartReply(interaction, { embeds: [error('Panel title must be 100 characters or less.')] }, true);
        
        const pId = rawPId.toLowerCase().replace(/[^a-z0-9-_]/g, ''); 
        await db.query(`INSERT INTO ticket_panels (guild_id, panel_id, title) VALUES ($1, $2, $3)`, [guildId, pId, title]); 
        return showPanelDashboard(interaction, db, guildId, pId); 
    }
    if (customId.startsWith('tkt_preview_')) { if (!await safeDefer(interaction, true)) return; const pId = customId.replace('tkt_preview_', ''); const menu = new ChannelSelectMenuBuilder().setCustomId(`tkt_deploy_final_${pId}`).setPlaceholder('Destination...').addChannelTypes(ChannelType.GuildText); await smartReply(interaction, { content: null, embeds: [new EmbedBuilder().setTitle('📨 Post').setDescription('Select channel.').setColor('#2ECC71')], components: [new ActionRowBuilder().addComponents(menu)] }); }
    
    if (interaction.isChannelSelectMenu() && customId.startsWith('tkt_deploy_final_')) { 
        if (!await safeDefer(interaction, true)) return; 
        const pId = customId.split('_')[3]; 
        const res = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, pId]); 
        const p = res.rows[0]; 
        const target = guild.channels.cache.get(values[0]); 
        const openBtn = new ButtonBuilder().setCustomId(`ticket_open_${pId}`).setLabel(p.button_label).setStyle(ButtonStyle[p.button_style] || ButtonStyle.Primary).setEmoji(p.button_emoji); 
        await target.send({ embeds: [new EmbedBuilder().setTitle(p.title).setDescription(p.description).setColor(p.panel_color || '#5865F2').setFooter({ text: 'Made by Ukirama' })], components: [new ActionRowBuilder().addComponents(openBtn)] }); 
        return await smartReply(interaction, { content: null, embeds: [success(`Panel posted in <#${values[0]}>`)] }); 
    }
};
