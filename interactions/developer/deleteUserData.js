const { DEVELOPER_IDS } = require('../../utils/config.js');
const { EmbedBuilder } = require('discord.js');

module.exports = async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('delete_user_data:')) return;
    
    const userId = interaction.customId.split(':')[1];
    const db = interaction.client.db;
    
    // Only developers can use this
    if (!DEVELOPER_IDS.includes(interaction.user.id)) {
        return interaction.reply({ content: '❌ Access Denied: Developer Only.', ephemeral: true });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
        // Check if request exists
        const requestRes = await db.query(
            "SELECT * FROM data_deletion_requests WHERE userid = $1 AND status = 'PENDING'",
            [userId]
        );
        
        if (requestRes.rows.length === 0) {
            return interaction.editReply({ content: '❌ No pending deletion request found for this user.' });
        }
        
        const request = requestRes.rows[0];
        
        // Remove all roles and assign unverified role if configured
        try {
            const statusRows = await db.query("SELECT guildid FROM verification_status WHERE userid = $1", [userId]);
            for (const row of statusRows.rows) {
                try {
                    const guild = await interaction.client.guilds.fetch(row.guildid).catch(() => null);
                    if (!guild) continue;
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (!member) continue;
                    // Remove ALL roles
                    const removableRoles = member.roles.cache.filter(r => r.id !== guild.id && r.editable);
                    if (removableRoles.size > 0) await member.roles.remove(removableRoles).catch(() => {});
                    // Add unverified role if configured
                    const configRes = await db.query("SELECT unverified_role_id FROM verification_config WHERE guildid = $1", [row.guildid]);
                    if (configRes.rows.length > 0 && configRes.rows[0].unverified_role_id) {
                        await member.roles.add(configRes.rows[0].unverified_role_id).catch(() => {});
                    }
                } catch (e) { /* guild/member not accessible */ }
            }
        } catch (e) { console.error('[DELETE-DATA] Error removing roles:', e); }

        // Delete all user data
        await db.query("DELETE FROM verification_status WHERE userid = $1", [userId]);
        await db.query("DELETE FROM user_ips WHERE userid = $1", [userId]);
        await db.query("DELETE FROM modlogs WHERE userid = $1", [userId]);
        await db.query("DELETE FROM afk_users WHERE userid = $1", [userId]);
        await db.query("DELETE FROM pending_appeals WHERE userid = $1", [userId]);
        await db.query("DELETE FROM ban_appeals WHERE user_id = $1", [userId]);
        
        // Mark request as completed
        await db.query(
            "UPDATE data_deletion_requests SET status = 'COMPLETED', deleted_at = $1 WHERE userid = $2",
            [Date.now(), userId]
        );
        
        // Update the original message
        const originalEmbed = interaction.message.embeds[0];
        const updatedEmbed = new EmbedBuilder()
            .setTitle(originalEmbed.title)
            .setDescription(originalEmbed.description)
            .addFields(originalEmbed.fields)
            .setColor(0x2ecc71)
            .setFooter({ text: `✅ Deleted by ${interaction.user.tag} at ${new Date().toLocaleString()}` })
            .setTimestamp();
        
        await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
        
        // Try to notify user
        try {
            const user = await interaction.client.users.fetch(userId);
            await user.send(`✅ Your data deletion request has been processed. All your data has been removed from our systems.`);
        } catch (e) {
            // User might have DMs disabled or left all common servers
        }
        
        await interaction.editReply({ content: `✅ All data for user **${request.username}** (${userId}) has been deleted.` });
        
    } catch (error) {
        console.error('[DELETE-DATA] Error:', error);
        await interaction.editReply({ content: `❌ An error occurred while deleting data: ${error.message}` });
    }
};
