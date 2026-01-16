const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder } = require('discord.js');
const db = require('../../../utils/db.js');
const { success } = require('../../../utils/embedFactory.js');
const { safeDefer } = require('../../../utils/interactionHelpers.js');
const { STAFF_COMMANDS } = require('../../../utils/config.js');

module.exports = async (interaction) => {
    const { customId, guild, values } = interaction;
    const guildId = guild.id;

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
};