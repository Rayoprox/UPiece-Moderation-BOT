const db = require('../utils/db.js');
const { safeDefer } = require('../utils/interactionHelpers.js');
const { error } = require('../utils/embedFactory.js');

const { validateCommandPermissions, sendCommandLog } = require('../utils/logicHelper.js');

module.exports = async (interaction) => {
    const client = interaction.client;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    const isPublic = command.isPublic ?? false;

    
    if (!await safeDefer(interaction, false, !isPublic)) return;

    try {
     
        const result = await validateCommandPermissions(
            client, 
            interaction.guild, 
            interaction.member, 
            interaction.user, 
            interaction.commandName, 
            db
        );

        if (!result.valid) {
            return interaction.editReply({ embeds: [error(result.reason)] });
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