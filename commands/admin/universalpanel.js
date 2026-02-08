const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../utils/db.js');
const { SUPREME_IDS, emojis } = require('../../utils/config.js');

module.exports = {
    deploy: 'main', 
    data: new SlashCommandBuilder()
        .setName('universalpanel')
        .setDescription('👑 Management Control Panel (Instance Owners Only).'),

    async execute(interaction) {
        if (!SUPREME_IDS.includes(interaction.user.id)) {
            return interaction.editReply({ 
                embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription(`${emojis.error} **ACCESS DENIED.** This panel is for Instance Owners only.`)]
            });
        }

        const res = await db.query('SELECT universal_lock FROM guild_settings WHERE guildid = $1', [interaction.guild.id]);
        const isLocked = res.rows[0]?.universal_lock || false;

        const embed = new EmbedBuilder()
            .setTitle('Management Control Panel')
            .setDescription(`Absolute control for Instance Owners in **${interaction.guild.name}**.`)
            .addFields(
                { name: `${isLocked ? '🔒' : '🔓'} ${interaction.guild.name} Lock`, value: isLocked ? 'Admins are **RESTRICTED**. Permissions are role-based only.' : 'Admins have **FULL ACCESS** (Standard).' },
                { name: '⚙️ /setup Access', value: 'Configure which roles can access the setup system.' }
            )
            .setColor(isLocked ? 0xFF0000 : 0x00FF00);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('univ_toggle_lock')
                .setLabel(isLocked ? 'Unlock Admins' : 'Lockdown Admins')
                .setStyle(isLocked ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('univ_config_setup')
                .setLabel('Manage /setup Access')
                .setStyle(ButtonStyle.Primary)
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
    },
};