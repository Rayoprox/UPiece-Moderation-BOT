const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder } = require('discord.js');
const db = require('../../../utils/db.js');
const { success } = require('../../../utils/embedFactory.js'); //
const { safeDefer } = require('../../../utils/interactionHelpers.js');
const { STAFF_COMMANDS } = require('../../../utils/config.js');
const guildCache = require('../../../utils/guildCache.js'); 

module.exports = async (interaction) => {
    const { customId, guild, values } = interaction;
    const guildId = guild.id;

    if (customId === 'setup_staff' || customId === 'setup_staff_menu') {
        if (!await safeDefer(interaction, true)) return;
        
        const res = await db.query("SELECT staff_roles FROM guild_settings WHERE guildid = $1", [guildId]);
        
        const rawRoles = res.rows[0]?.staff_roles;
        const currentRoles = rawRoles ? rawRoles.split(',').map(r => `<@&${r}>`).join(', ') : '`None`';
        const commandList = STAFF_COMMANDS.map(c => `\`${c}\``).join(', ');

        const embed = new EmbedBuilder()
            .setTitle('🛡️ Staff Roles')
            .setDescription(`Roles with Staff access.\n\n**Current:**\n${currentRoles}`)
            .addFields({ name: 'Commands', value: commandList })
            .setColor('#3498DB');

        const menu = new RoleSelectMenuBuilder()
            .setCustomId('select_staff_roles')
            .setPlaceholder('Select roles...')
            .setMinValues(0)
            .setMaxValues(25);

        const back = new ButtonBuilder().setCustomId('setup_menu_permissions').setLabel('Back').setStyle(ButtonStyle.Secondary);
        const reset = new ButtonBuilder()
            .setCustomId('setup_staff_delete')
            .setLabel('Reset')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️')
            .setDisabled(!rawRoles); 

        const rowButtons = new ActionRowBuilder().addComponents(back, reset);

        await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), rowButtons] });
        return;
    }

    if (interaction.isRoleSelectMenu() && customId === 'select_staff_roles') {
        if (!await safeDefer(interaction, true)) return;
        
        await db.query("INSERT INTO guild_settings (guildid, staff_roles) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET staff_roles = $2", [guildId, values.join(',')]);
        guildCache.flush(guildId);
        
        const back = new ButtonBuilder().setCustomId('setup_staff').setLabel('Back').setStyle(ButtonStyle.Primary);
        await interaction.editReply({ embeds: [success(`Staff roles updated!`)], components: [new ActionRowBuilder().addComponents(back)] });
    }

    if (customId === 'setup_staff_delete') {
        if (!await safeDefer(interaction, true)) return;

        await db.query("UPDATE guild_settings SET staff_roles = NULL WHERE guildid = $1", [guildId]);
        guildCache.flush(guildId);

        interaction.customId = 'setup_staff';
        return module.exports(interaction);
    }
};
