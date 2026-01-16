const universalPanel = require('../interactions/admin/universalPanel');
const setupSystem = require('../interactions/admin/setup');
const ticketSetup = require('../interactions/tickets/ticketSetup'); 
const automodSystem = require('../interactions/admin/automod');
const appealSystem = require('../interactions/features/appeals');
const logSystem = require('../interactions/moderation/logs');

const { handleTicketOpen } = require('../interactions/tickets/ticketHandler');
const { handleTicketActions } = require('../interactions/tickets/ticketActions'); 

module.exports = async (interaction) => {
    const { customId, client } = interaction;

    if (customId.startsWith('univ_')) return await universalPanel(interaction);
    if (customId.startsWith('automod_') || customId === 'setup_automod') return await automodSystem(interaction);
    
    if (customId === 'setup_tickets_menu' || customId.startsWith('ticket_panel_') || customId.startsWith('tkt_')) {
        return await ticketSetup(interaction);
    }

    if (customId.startsWith('setup_') || customId.startsWith('select_') || customId === 'delete_all_data' || customId === 'confirm_delete_data' || customId === 'cancel_setup' || customId.startsWith('antinuke_') || customId.startsWith('perms_role_select_')) {
        return await setupSystem.execute(interaction); 
    }

    if (customId.startsWith('appeal:') || customId === 'start_appeal_process') return await appealSystem(interaction);
    if (customId.startsWith('modlogs_') || customId.startsWith('warns_')) return await logSystem(interaction);

   
    if (customId.startsWith('ticket_open_')) {
        await handleTicketOpen(interaction, client);
        return;
    }
    
   
    if (customId.startsWith('ticket_action_') || customId.startsWith('ticket_close_') || customId.startsWith('ticket_claim_')) {
        await handleTicketActions(interaction, client); 
        return;
    }

    console.warn(`[HANDLER] Interacción sin manejador: ${customId}`);
};