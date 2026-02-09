const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, RoleSelectMenuBuilder } = require('discord.js');
const db = require('../../../utils/db.js');

async function showCustomCommandsMenu(interaction) {
    const { guild } = interaction;
    
    const res = await db.query('SELECT * FROM custom_commands WHERE guildid = $1 ORDER BY name ASC', [guild.id]);
    const commands = res.rows;

    const embed = new EmbedBuilder()
        .setColor('#2B2D31')
        .setTitle('🔧 Custom Commands Manager')
        .setDescription(commands.length > 0 
            ? `Current commands using prefix:\n${commands.map(c => `\`${c.name}\``).join(', ')}`
            : "No custom commands created yet.")
        .setFooter({ text: 'Commands are prefix-only.' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('setup_cc_add').setLabel('Add Command').setStyle(ButtonStyle.Success).setEmoji('➕'),
        new ButtonBuilder().setCustomId('setup_home').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji('⬅️')
    );

    const components = [row];
    if (commands.length > 0) {
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('setup_cc_select_edit')
            .setPlaceholder('Select a command to edit...')
            .addOptions(commands.slice(0, 25).map(c => ({
                label: c.name,
                description: 'Click to edit response/embed or permissions',
                value: c.name
            })));
        components.unshift(new ActionRowBuilder().addComponents(selectMenu));
    }

    await interaction.update({ embeds: [embed], components: components });
}

async function showCommandEditor(interaction, commandName) {
    const res = await db.query('SELECT * FROM custom_commands WHERE guildid = $1 AND name = $2', [interaction.guild.id, commandName]);
    
    if (res.rows.length === 0) return showCustomCommandsMenu(interaction);

    const commandData = res.rows[0];
    const responseData = JSON.parse(commandData.response_json);
    const allowedRoles = commandData.allowed_roles ? JSON.parse(commandData.allowed_roles) : [];

    const previewEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`🛠️ Editing: !${commandName}`)
        .addFields(
            { name: 'Content Type', value: responseData.embeds && responseData.embeds.length > 0 ? 'Embed Message' : 'Text Only', inline: true },
            { name: 'Permissions', value: allowedRoles.length > 0 ? `${allowedRoles.length} Roles Allowed` : '🛑 Admin Only (Default)', inline: true }
        );

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`setup_cc_edit_text_${commandName}`).setLabel('Edit Text').setStyle(ButtonStyle.Primary).setEmoji('📝'),
        new ButtonBuilder().setCustomId(`setup_cc_edit_embed_${commandName}`).setLabel(responseData.embeds?.length ? 'Edit Embed' : 'Add Embed').setStyle(ButtonStyle.Primary).setEmoji('🖼️'),
        new ButtonBuilder().setCustomId(`setup_cc_perms_menu_${commandName}`).setLabel('Permissions').setStyle(ButtonStyle.Secondary).setEmoji('🔐')
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`setup_cc_del_embed_${commandName}`).setLabel('Remove Embed').setStyle(ButtonStyle.Danger).setDisabled(!responseData.embeds?.length).setEmoji('🗑️'),
        new ButtonBuilder().setCustomId(`setup_cc_delete_${commandName}`).setLabel('Delete Command').setStyle(ButtonStyle.Danger).setEmoji('✖️'),
        new ButtonBuilder().setCustomId('setup_cc_menu').setLabel('Back to List').setStyle(ButtonStyle.Secondary).setEmoji('⬅️')
    );

    await interaction.update({ embeds: [previewEmbed], components: [row1, row2] });
}

async function showPermissionsEditor(interaction, commandName) {
    const res = await db.query('SELECT allowed_roles FROM custom_commands WHERE guildid = $1 AND name = $2', [interaction.guild.id, commandName]);
    if (res.rows.length === 0) return showCustomCommandsMenu(interaction);

    const allowedRoles = res.rows[0].allowed_roles ? JSON.parse(res.rows[0].allowed_roles) : [];

    const embed = new EmbedBuilder()
        .setTitle(`🔐 Permissions for !${commandName}`)
        .setColor('#F1C40F')
        .setDescription(allowedRoles.length > 0 
            ? `**Allowed Roles:**\n${allowedRoles.map(r => `<@&${r}>`).join(', ')}`
            : "**Restricted Mode:**\nSince no roles are selected, this command is strictly for **Administrators** only.")
        .setFooter({ text: 'Select roles below to allow them. Unselect to remove.' });

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId(`select_cc_roles_${commandName}`)
        .setPlaceholder('Select roles allowed to use this command...')
        .setMinValues(0)
        .setMaxValues(25);

    const row1 = new ActionRowBuilder().addComponents(roleSelect);
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`setup_cc_edit_back_${commandName}`).setLabel('Back to Editor').setStyle(ButtonStyle.Secondary).setEmoji('⬅️')
    );

    await interaction.update({ embeds: [embed], components: [row1, row2] });
}

module.exports = {
    name: 'custom_commands',
    async execute(interaction) {
        const id = interaction.customId;

        if (id === 'setup_cc_menu') return showCustomCommandsMenu(interaction);

        if (id === 'setup_cc_add') {
            const modal = new ModalBuilder().setCustomId('modal_cc_create').setTitle('Create New Command');
            const nameInput = new TextInputBuilder().setCustomId('cc_name').setLabel("Command Name").setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
            return interaction.showModal(modal);
        }

        if (id === 'setup_cc_select_edit') {
            return showCommandEditor(interaction, interaction.values[0]);
        }

      
        if (id.startsWith('setup_cc_perms_menu_')) {
            const name = id.replace('setup_cc_perms_menu_', '');
            return showPermissionsEditor(interaction, name);
        }
        
       
        if (id.startsWith('select_cc_roles_')) {
            const name = id.replace('select_cc_roles_', '');
            const selectedRoles = interaction.values; 
            
            await db.query('UPDATE custom_commands SET allowed_roles = $1 WHERE guildid = $2 AND name = $3', 
                [JSON.stringify(selectedRoles), interaction.guild.id, name]);
            
            return showPermissionsEditor(interaction, name);
        }

        if (id.startsWith('setup_cc_edit_back_')) {
            return showCommandEditor(interaction, id.replace('setup_cc_edit_back_', ''));
        }

        if (id.startsWith('setup_cc_delete_')) {
            const name = id.replace('setup_cc_delete_', '');
            await db.query('DELETE FROM custom_commands WHERE guildid = $1 AND name = $2', [interaction.guild.id, name]);
            return showCustomCommandsMenu(interaction);
        }

        if (id.startsWith('setup_cc_del_embed_')) {
            const name = id.replace('setup_cc_del_embed_', '');
            const res = await db.query('SELECT response_json FROM custom_commands WHERE guildid = $1 AND name = $2', [interaction.guild.id, name]);
            if (!res.rows.length) return;
            let data = JSON.parse(res.rows[0].response_json);
            delete data.embeds;
            await db.query('UPDATE custom_commands SET response_json = $1 WHERE guildid = $2 AND name = $3', [JSON.stringify(data), interaction.guild.id, name]);
            return showCommandEditor(interaction, name);
        }

        if (id.startsWith('setup_cc_edit_text_')) {
            const name = id.replace('setup_cc_edit_text_', '');
            const res = await db.query('SELECT response_json FROM custom_commands WHERE guildid = $1 AND name = $2', [interaction.guild.id, name]);
            const currentContent = res.rows.length ? JSON.parse(res.rows[0].response_json).content || '' : '';
            const modal = new ModalBuilder().setCustomId(`modal_cc_text_${name}`).setTitle('Edit Text Content');
            const input = new TextInputBuilder().setCustomId('cc_text_val').setLabel("Message Content").setStyle(TextInputStyle.Paragraph).setValue(currentContent).setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }

        if (id.startsWith('setup_cc_edit_embed_')) {
            const name = id.replace('setup_cc_edit_embed_', '');
            const res = await db.query('SELECT response_json FROM custom_commands WHERE guildid = $1 AND name = $2', [interaction.guild.id, name]);
            let current = {};
            if (res.rows.length) {
                const data = JSON.parse(res.rows[0].response_json);
                if (data.embeds && data.embeds[0]) current = data.embeds[0];
            }
            const modal = new ModalBuilder().setCustomId(`modal_cc_embed_${name}`).setTitle('Edit Embed Details');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cc_emb_title').setLabel("Title").setStyle(TextInputStyle.Short).setValue(current.title || '').setRequired(false)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cc_emb_desc').setLabel("Description").setStyle(TextInputStyle.Paragraph).setValue(current.description || '').setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cc_emb_color').setLabel("Color (Hex)").setStyle(TextInputStyle.Short).setValue(current.color ? '#' + current.color.toString(16) : '').setPlaceholder('#5865F2').setRequired(false)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cc_emb_image').setLabel("Image URL").setStyle(TextInputStyle.Short).setValue(current.image?.url || '').setRequired(false))
            );
            return interaction.showModal(modal);
        }
    },

    async handleModal(interaction) {
        const id = interaction.customId;

        if (id === 'modal_cc_create') {
            const name = interaction.fields.getTextInputValue('cc_name').toLowerCase().replace(/\s+/g, '-');
            const initialData = { content: "New custom command!" };
            try {
                await db.query('INSERT INTO custom_commands (guildid, name, response_json) VALUES ($1, $2, $3)', [interaction.guild.id, name, JSON.stringify(initialData)]);
                await showCommandEditor(interaction, name);
            } catch (err) {
                interaction.reply({ content: "Error: Command name likely already exists.", ephemeral: true });
            }
        }

        if (id.startsWith('modal_cc_text_')) {
            const name = id.replace('modal_cc_text_', '');
            const content = interaction.fields.getTextInputValue('cc_text_val');
            const res = await db.query('SELECT response_json FROM custom_commands WHERE guildid = $1 AND name = $2', [interaction.guild.id, name]);
            let data = JSON.parse(res.rows[0].response_json);
            data.content = content;
            await db.query('UPDATE custom_commands SET response_json = $1 WHERE guildid = $2 AND name = $3', [JSON.stringify(data), interaction.guild.id, name]);
            await showCommandEditor(interaction, name);
        }

        if (id.startsWith('modal_cc_embed_')) {
            const name = id.replace('modal_cc_embed_', '');
            const title = interaction.fields.getTextInputValue('cc_emb_title');
            const desc = interaction.fields.getTextInputValue('cc_emb_desc');
            let color = interaction.fields.getTextInputValue('cc_emb_color').replace('#', '');
            const image = interaction.fields.getTextInputValue('cc_emb_image');

            const embedObj = {
                description: desc,
                title: title || null,
                color: color ? parseInt(color, 16) : 0x5865F2,
                image: image ? { url: image } : null
            };

            const res = await db.query('SELECT response_json FROM custom_commands WHERE guildid = $1 AND name = $2', [interaction.guild.id, name]);
            let data = JSON.parse(res.rows[0].response_json);
            data.embeds = [embedObj];
            await db.query('UPDATE custom_commands SET response_json = $1 WHERE guildid = $2 AND name = $3', [JSON.stringify(data), interaction.guild.id, name]);
            await showCommandEditor(interaction, name);
        }
    }
};
