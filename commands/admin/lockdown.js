const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../utils/db.js');
const { success, error, moderation } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('lockdown')
        .setDescription('LOCKDOWN: Backs up permissions and makes configured channels private.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),

    async execute(interaction) {
        const { guild } = interaction;

        const res = await db.query("SELECT channel_id FROM lockdown_channels WHERE guildid = $1", [guild.id]);
        if (res.rows.length === 0) {
            return interaction.editReply({ embeds: [error("No lockdown channels configured. Use `/setup` -> Protection -> Lockdown.")] });
        }

        let lockedCount = 0;

        for (const row of res.rows) {
            const channel = guild.channels.cache.get(row.channel_id);
            if (!channel) continue;

            try {
                const currentOverwrites = channel.permissionOverwrites.cache.map(o => ({
                    id: o.id,
                    type: o.type,
                    allow: o.allow.bitfield.toString(),
                    deny: o.deny.bitfield.toString()
                }));

                await db.query(
                    "INSERT INTO lockdown_backups (guildid, channel_id, permissions_json) VALUES ($1, $2, $3) ON CONFLICT (guildid, channel_id) DO UPDATE SET permissions_json = $3",
                    [guild.id, channel.id, JSON.stringify(currentOverwrites)]
                );

                await channel.permissionOverwrites.set([
                    {
                        id: guild.id, 
                        deny: [PermissionsBitField.Flags.ViewChannel],
                    }
                ]);

                lockedCount++;
            } catch (err) {
                console.error(`Failed to lock channel ${channel.id}:`, err);
            }
        }

        const embed = moderation(`**SERVER LOCKDOWN ACTIVE**\n\n**Channels Locked:** ${lockedCount}\nAll role permissions stripped temporarily.`);
        await interaction.editReply({ embeds: [embed] });
    },
};
