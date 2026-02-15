const db = require('../utils/db.js');
const { safeDefer } = require('../utils/interactionHelpers.js');
const { error } = require('../utils/embedFactory.js');

const { checkCommandAvailability, validateCommandPermissions, sendCommandLog } = require('../utils/logicHelper.js');

module.exports = async (interaction) => {
    const client = interaction.client;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    const isPublic = command.isPublic ?? false;

    
    if (!await safeDefer(interaction, false, !isPublic)) return;

    try {
     
        const availability = await checkCommandAvailability(interaction.guild, interaction.commandName, db, interaction.channelId);
        if (!availability.available) {
            await interaction.editReply({ embeds: [error(availability.reason)] });
            setTimeout(() => {
                interaction.deleteReply().catch(() => {});
            }, 3000);
            return;
        }

        const result = await validateCommandPermissions(
            client, 
            interaction.guild, 
            interaction.member, 
            interaction.user, 
            interaction.commandName,
            db,
            interaction.channelId
        );

        if (!result.valid) {
            await interaction.editReply({ embeds: [error(result.reason)] });
            return;
        }

        await command.execute(interaction);
        
        
        await sendCommandLog(interaction, db, result.isAdmin).catch(() => {});

    } catch (err) {
        console.error(`[HANDLER ERROR] ${interaction.commandName}:`, err);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds: [error('An unexpected error occurred executing this command.')] }).catch(() => {});
        }
    }
};
