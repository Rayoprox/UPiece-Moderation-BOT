const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { SUPREME_IDS, emojis } = require('../../utils/config.js');
const { safeDefer } = require('../../utils/interactionHelpers.js');
const guildCache = require('../../utils/guildCache.js');
const { handleCommandSelect } = require('../../utils/setup_handle_command_select.js'); 
const { success } = require('../../utils/embedFactory.js');

module.exports = async (interaction) => {
    const { customId, guild, user, client, values } = interaction;
    const db = client.db;

    if (!SUPREME_IDS.includes(user.id)) {
        return interaction.reply({ content: '⛔ Supreme Access Only.', flags: [MessageFlags.Ephemeral] });
    }

    if (customId === 'univ_back_main') {
        if (!await safeDefer(interaction, true)) return;
        const cmd = client.commands.get('universalpanel');
        return await cmd.execute(interaction);
    }

    if (customId === 'univ_toggle_lock') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT universal_lock FROM guild_settings WHERE guildid = $1", [guild.id]);
        const newState = !(res.rows[0]?.universal_lock);
        await db.query("INSERT INTO guild_settings (guildid, universal_lock) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET universal_lock = $2", [guild.id, newState]);
        guildCache.flush(guild.id);
        
        const cmd = client.commands.get('universalpanel');
        return await cmd.execute(interaction);
    }

    if (customId === 'univ_config_setup') {
        if (!await safeDefer(interaction, true)) return;
        
        const { embeds, components } = await handleCommandSelect({ values: ['setup'], client, guild });
        
        components[0].components[0].setCustomId('univ_role_select_setup');
        
        const nav = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('univ_back_main').setLabel('Back to Control Panel').setStyle(ButtonStyle.Secondary)
        );
        
        await interaction.editReply({ embeds, components: [components[0], nav] });
    }

    if (customId === 'univ_role_select_setup') {
        if (!await safeDefer(interaction, true)) return;
        
        await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name = 'setup'", [guild.id]);
        for (const roleId of values) {
            await db.query("INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, 'setup', $2)", [guild.id, roleId]);
        }
        guildCache.flush(guild.id);

        const nav = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('univ_back_main').setLabel('Return to Panel').setStyle(ButtonStyle.Primary)
        );
        
        await interaction.editReply({ 
            embeds: [success('**Access Rules Updated.** Only selected roles can now use `/setup`.')], 
            components: [nav] 
        });
    }
};
