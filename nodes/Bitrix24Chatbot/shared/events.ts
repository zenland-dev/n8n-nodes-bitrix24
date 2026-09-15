import type { IDataObject } from 'n8n-workflow';

import type { Bitrix24Context } from '../../../shared/transport';
import { botRequest } from './bot';

/** The event types imbot.v2.Event.get delivers, as of 14.09.2026 (REST revision 35). */
export const BOT_EVENTS = [
	{ name: 'Bot Added to Chat', value: 'ONIMBOTV2JOINCHAT', description: 'Someone added the bot to a chat; a greeting usually follows' },
	{ name: 'Bot Deleted', value: 'ONIMBOTV2DELETE', description: 'The bot was unregistered. The last event it gets.' },
	{ name: 'Chat Opened With Context', value: 'ONIMBOTV2CONTEXTGET', description: 'Someone opened the chat with the bot through a link carrying BOT_CONTEXT data' },
	{ name: 'Command Called', value: 'ONIMBOTV2COMMANDADD', description: 'A slash command of the bot was typed, or a keyboard button with a COMMAND was pressed' },
	{ name: 'Message Deleted', value: 'ONIMBOTV2MESSAGEDELETE' },
	{ name: 'Message Edited', value: 'ONIMBOTV2MESSAGEUPDATE' },
	{ name: 'New Message', value: 'ONIMBOTV2MESSAGEADD', description: 'A message to the bot: every message of a private chat; in a group chat only a mention of the bot, unless the bot is a supervisor or personal assistant' },
	{ name: 'Reaction Changed', value: 'ONIMBOTV2REACTIONCHANGE', description: 'Someone put or took off a reaction on a message of the bot' },
];

/** Most events one imbot.v2.Event.get call returns. */
export const BOT_EVENT_PAGE = 1000;

export interface BotEventPage {
	events: IDataObject[];
	nextOffset: number | undefined;
	hasMore: boolean;
}

/**
 * One call to the event queue of a bot. Passing `offset` confirms, and so deletes, every
 * event before it — for every reader of that bot, not just this one.
 */
export async function readBotEvents(
	this: Bitrix24Context,
	botId: number,
	offset: number | undefined,
	limit: number,
	options: { withUserEvents?: boolean; itemIndex?: number } = {},
): Promise<BotEventPage> {
	const params: IDataObject = { botId, limit };
	if (offset !== undefined) params.offset = offset;
	if (options.withUserEvents === true) params.withUserEvents = true;
	const body = await botRequest.call(this, 'imbot.v2.Event.get', params, options.itemIndex);
	const result = (body.result ?? {}) as IDataObject;
	const next = Number(result.nextOffset);
	return {
		events: Array.isArray(result.events) ? (result.events as IDataObject[]) : [],
		nextOffset: Number.isFinite(next) && next > 0 ? next : undefined,
		hasMore: result.hasMore === true,
	};
}
