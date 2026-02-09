const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../utils/db.js');
const { success, error, moderation } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('unlockdown')
        .setDescription('UNLOCKDOWN: Restores permissions from the last lockdown.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),

    async execute(interaction) {
        const { guild } = interaction;

        const res = await db.query("SELECT channel_id, permissions_json FROM lockdown_backups WHERE guildid = $1", [guild.id]);
        if (res.rows.length === 0) {
            return interaction.editReply({ embeds: [error("No active lockdown backup found.")] });
        }

        let unlockedCount = 0;

        for (const row of res.rows) {
            const channel = guild.channels.cache.get(row.channel_id);
            if (!channel) continue;

            try {
                const savedOverwrites = JSON.parse(row.permissions_json);
                
                await channel.permissionOverwrites.set(savedOverwrites);
                unlockedCount++;
            } catch (err) {
                console.error(`Failed to unlock channel ${channel.id}:`, err);
            }
        }

        await db.query("DELETE FROM lockdown_backups WHERE guildid = $1", [guild.id]);

        const embed = moderation(`**SERVER LOCKDOWN LIFTED**\n\n**Channels Restored:** ${unlockedCount}\nOriginal permissions restored.`);
        await interaction.editReply({ embeds: [embed] });
    },
};
