const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const ms = require('ms');
const { success, error, moderation } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('slowmode')
        .setDescription('Set the slowmode for the current channel.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Time (e.g., 5s, 10m, 6h) or "off" to disable.')
                .setRequired(true)
        ),

    async execute(interaction) {
        const input = interaction.options.getString('duration');
        let seconds = 0;

        if (input.toLowerCase() === 'off' || input === '0') {
            seconds = 0;
        } else {
            const milliseconds = ms(input);
            if (!milliseconds || isNaN(milliseconds)) {
                return interaction.editReply({ embeds: [error('Invalid time format.\nTry using: `5s`, `10m`, `2h`, or `off`.')] });
            }
            seconds = Math.floor(milliseconds / 1000);
        }

        if (seconds > 21600) {
            return interaction.editReply({ embeds: [error('Slowmode cannot exceed 6 hours (21600s).')] });
        }

        try {
            await interaction.channel.setRateLimitPerUser(seconds);

            let description;
            if (seconds === 0) {
                description = `**Slowmode Disabled**\nThe channel is back to normal speed.`;
            } else {
                description = `**Slowmode Enabled**\nSet to **${input}** (${seconds} seconds).`;
            }
            
            await interaction.editReply({ embeds: [moderation(description)] });

        } catch (err) {
            console.error(err);
            await interaction.editReply({ embeds: [error('Failed to set slowmode. Check my permissions.')] });
        }
    },
};