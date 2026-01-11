// handlers/componentHandler.js

const universalPanel = require('../interactions/admin/universalPanel');
const setupSystem = require('../interactions/admin/setup');
const automodSystem = require('../interactions/admin/automod');
const appealSystem = require('../interactions/features/appeals');
const logSystem = require('../interactions/moderation/logs');

module.exports = async (interaction) => {
    const { customId } = interaction;

    // 1. Universal Panel
    if (customId.startsWith('univ_')) {
        return await universalPanel(interaction);
    }

    // 2. Automod (LO PONEMOS ANTES QUE SETUP Y CAPTURAMOS SU BOTÓN ESPECÍFICO)
    if (customId.startsWith('automod_') || customId === 'setup_automod') {
        return await automodSystem(interaction);
    }

    // 3. Setup (El resto de configuraciones)
    if (customId.startsWith('setup_') || customId.startsWith('select_') || customId === 'delete_all_data' || customId === 'confirm_delete_data' || customId.startsWith('antinuke_') || customId.startsWith('perms_role_select_')) {
        return await setupSystem(interaction);
    }

    // 4. Apelaciones
    if (customId.startsWith('appeal:') || customId === 'start_appeal_process') {
        return await appealSystem(interaction);
    }

    // 5. Logs y Warns
    if (customId.startsWith('modlogs_') || customId.startsWith('warns_')) {
        return await logSystem(interaction);
    }

    console.warn(`[HANDLER] Interacción sin manejador: ${customId}`);
};