import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { valuesOf } from '../../../shared/offset';
import { numberProperty, positiveInt, rows } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { yn } from '../../../shared/values';
import { chatIdProperty, chatOperation, readChatId } from '../shared/helpers';

const USER_CODE_DESCRIPTION = 'The client in the channel: connector|line|chat|user, e.g. livechat|1|1373|211 or telegrambot|2|209607941|744. Dialog → Get shows it as entity_id.';

const sessionIdProperty = numberProperty('Session ID', 'sessionId', 'One conversation cycle inside a chat; Statistics → Get Sessions and Get History show it');

const historyOutput: INodeProperties = {
	displayName: 'Output',
	name: 'output',
	type: 'options',
	default: 'messages',
	options: [
		{ name: 'One Item per Message', value: 'messages', description: 'Messages oldest first, each with its author' },
		{ name: 'Whole Answer', value: 'raw', description: 'Messages, users, files and chat data as Bitrix24 returns them' },
	],
};

export const dialogResource: Resource = {
	value: 'dialog',
	name: 'Dialog',
	description: 'Conversations with clients in open channels: find, read, start sessions, join, pin, rate',
	operations: [
		{
			value: 'get',
			name: 'Get',
			action: 'Get an open line dialog',
			description: 'Retrieve an open channel chat by chat ID, session ID or the client\'s user code',
			properties: [
				{
					displayName: 'Find By',
					name: 'findBy',
					type: 'options',
					default: 'chat',
					options: [
						{ name: 'Chat ID', value: 'chat' },
						{ name: 'Client User Code', value: 'userCode' },
						{ name: 'Session ID', value: 'session' },
					],
				},
				{ ...chatIdProperty, displayOptions: { show: { findBy: ['chat'] } } },
				{ ...sessionIdProperty, displayOptions: { show: { findBy: ['session'] } } },
				{ displayName: 'User Code', name: 'userCode', type: 'string', required: true, default: '', displayOptions: { show: { findBy: ['userCode'] } }, description: USER_CODE_DESCRIPTION },
			],
			async execute(itemIndex) {
				const by = this.getNodeParameter('findBy', itemIndex) as string;
				let params: IDataObject;
				if (by === 'session') params = { SESSION_ID: positiveInt(this, 'sessionId', itemIndex, 'Session ID') };
				else if (by === 'userCode') params = { USER_CODE: String(this.getNodeParameter('userCode', itemIndex)).trim() };
				else params = { CHAT_ID: readChatId(this, itemIndex) };
				const body = await bitrix24Request.call(this, 'imopenlines.dialog.get', params, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'getChatByUserCode',
			name: 'Get Chat by User Code',
			action: 'Get the chat of a client',
			description: 'Get the open channel chat ID of a client from their code in the channel',
			properties: [{ displayName: 'User Code', name: 'userCode', type: 'string', required: true, default: '', description: USER_CODE_DESCRIPTION }],
			async execute(itemIndex) {
				const userCode = String(this.getNodeParameter('userCode', itemIndex) ?? '').trim();
				if (userCode === '') throw new NodeOperationError(this.getNode(), 'User Code is required', { itemIndex });
				const body = await bitrix24Request.call(this, 'imopenlines.session.open', { USER_CODE: userCode }, { itemIndex });
				const chatId = Number((body.result as IDataObject | null)?.chatId);
				return { userCode, chatId: chatId > 0 ? chatId : null };
			},
		},
		{
			value: 'getHistory',
			name: 'Get History',
			action: 'Get the messages of a dialog',
			description: 'Read the messages of an open channel session, by session ID or the latest session of a chat',
			properties: [
				{
					displayName: 'Find By',
					name: 'findBy',
					type: 'options',
					default: 'session',
					options: [
						{ name: 'Latest Session of a Chat', value: 'chat' },
						{ name: 'Session ID', value: 'session' },
					],
				},
				{ ...sessionIdProperty, displayOptions: { show: { findBy: ['session'] } } },
				{ ...chatIdProperty, displayOptions: { show: { findBy: ['chat'] } } },
				historyOutput,
			],
			async execute(itemIndex) {
				const params: IDataObject =
					this.getNodeParameter('findBy', itemIndex) === 'chat'
						? { CHAT_ID: readChatId(this, itemIndex) }
						: { SESSION_ID: positiveInt(this, 'sessionId', itemIndex, 'Session ID') };
				const body = await bitrix24Request.call(this, 'imopenlines.session.history.get', params, { itemIndex });
				const result = (body.result ?? {}) as IDataObject;
				if (this.getNodeParameter('output', itemIndex) === 'raw') return rows(result);
				const users = (result.users ?? {}) as IDataObject;
				return valuesOf(result.message)
					.sort((a, b) => Number(a.id) - Number(b.id))
					.map((message) => {
						const author = users[String(message.senderid)] as IDataObject | undefined;
						return { sessionId: result.sessionId ?? null, chatId: result.chatId ?? null, ...message, ...(author ? { author } : {}) };
					});
			},
		},
		chatOperation('startSession', 'Start Session', 'Start a new session in a dialog', 'Start a new conversation cycle in an open channel chat', 'imopenlines.session.start'),
		{
			value: 'startSessionFromMessage',
			name: 'Start Session From Message',
			action: 'Start a new session from a message',
			description: 'Start a new conversation cycle and move the given message into it',
			properties: [chatIdProperty, numberProperty('Message ID', 'messageId', 'A message of the chat; Get History lists them')],
			async execute(itemIndex) {
				const params = { CHAT_ID: readChatId(this, itemIndex), MESSAGE_ID: positiveInt(this, 'messageId', itemIndex, 'Message ID') };
				const body = await bitrix24Request.call(this, 'imopenlines.message.session.start', params, { itemIndex });
				return { chatId: params.CHAT_ID, messageId: params.MESSAGE_ID, success: body.result === true };
			},
		},
		chatOperation('join', 'Join', 'Join a dialog', 'Add the webhook user to an active open channel conversation next to its operator', 'imopenlines.session.join'),
		chatOperation('intercept', 'Take Over', 'Take over a dialog', 'Take an active conversation away from its operator and give it to the webhook user', 'imopenlines.session.intercept'),
		{
			value: 'pin',
			name: 'Pin or Unpin',
			action: 'Pin or unpin a dialog',
			description: 'Pin a conversation to the webhook user as operator so it does not close or move, or unpin it',
			properties: [chatIdProperty, { displayName: 'Pin', name: 'pin', type: 'boolean', default: true, description: 'Whether to pin (on) or unpin (off)' }],
			async execute(itemIndex) {
				const chatId = readChatId(this, itemIndex);
				const pin = this.getNodeParameter('pin', itemIndex) === true;
				const body = await bitrix24Request.call(this, 'imopenlines.session.mode.pin', { CHAT_ID: chatId, ACTIVATE: yn(pin) }, { itemIndex });
				return { chatId, pinned: pin, success: body.result === true };
			},
		},
		{
			value: 'pinAll',
			name: 'Pin All',
			action: 'Pin every available dialog',
			description: 'Pin every active conversation available to the webhook user as operator',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'imopenlines.session.mode.pinAll', {}, { itemIndex });
				return { sessionIds: Array.isArray(body.result) ? body.result.map(Number) : [] };
			},
		},
		{
			value: 'unpinAll',
			name: 'Unpin All',
			action: 'Unpin every pinned dialog',
			description: 'Unpin every conversation pinned to the webhook user as operator',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'imopenlines.session.mode.unpinAll', {}, { itemIndex });
				return { sessionIds: Array.isArray(body.result) ? body.result.map(Number) : [] };
			},
		},
		{
			value: 'setSilentMode',
			name: 'Set Silent Mode',
			action: 'Turn silent mode of a dialog on or off',
			description: 'In silent mode operator messages are not sent to the client. Bitrix24 no longer develops this method, though it works.',
			properties: [chatIdProperty, { displayName: 'Silent', name: 'silent', type: 'boolean', default: true, description: 'Whether to turn silent mode on (on) or off (off)' }],
			async execute(itemIndex) {
				const chatId = readChatId(this, itemIndex);
				const silent = this.getNodeParameter('silent', itemIndex) === true;
				const body = await bitrix24Request.call(this, 'imopenlines.session.mode.silent', { CHAT_ID: chatId, ACTIVATE: yn(silent) }, { itemIndex });
				return { chatId, silent, success: body.result === true };
			},
		},
		{
			value: 'rate',
			name: 'Rate as Supervisor',
			action: 'Rate a finished dialog as supervisor',
			description: 'Save a supervisor rating from 1 to 5 and a comment for a finished session',
			properties: [
				sessionIdProperty,
				{ displayName: 'Rating', name: 'rating', type: 'number', typeOptions: { minValue: 0, maxValue: 5 }, default: 5, description: 'From 1 to 5; 0 to leave only a comment' },
				{ displayName: 'Comment', name: 'comment', type: 'string', typeOptions: { rows: 3 }, default: '' },
			],
			async execute(itemIndex) {
				const params: IDataObject = { SESSION_ID: positiveInt(this, 'sessionId', itemIndex, 'Session ID') };
				const rating = Number(this.getNodeParameter('rating', itemIndex, 0));
				if (rating !== 0) {
					if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new NodeOperationError(this.getNode(), 'Rating must be from 1 to 5, or 0 for none', { itemIndex });
					params.RATING = rating;
				}
				const comment = String(this.getNodeParameter('comment', itemIndex, '') ?? '');
				if (comment.trim() !== '') params.COMMENT = comment;
				if (params.RATING === undefined && params.COMMENT === undefined) throw new NodeOperationError(this.getNode(), 'Give a rating, a comment, or both', { itemIndex });
				const body = await bitrix24Request.call(this, 'imopenlines.session.head.vote', params, { itemIndex });
				return { sessionId: params.SESSION_ID, rating: params.RATING ?? null, success: body.result === true };
			},
		},
		chatOperation('createLead', 'Create Lead', 'Create a CRM lead from a dialog', 'Create a CRM lead from the client of an open channel chat', 'imopenlines.crm.lead.create'),
		{
			value: 'saveQuickAnswer',
			name: 'Save as Quick Answer',
			action: 'Save a message as a quick answer',
			description: 'Add a message of an open channel chat to the quick answers of the line',
			properties: [chatIdProperty, numberProperty('Message ID', 'messageId', 'A message of the chat; Get History lists them')],
			async execute(itemIndex) {
				const params = { CHAT_ID: readChatId(this, itemIndex), MESSAGE_ID: positiveInt(this, 'messageId', itemIndex, 'Message ID') };
				const body = await bitrix24Request.call(this, 'imopenlines.message.quick.save', params, { itemIndex });
				return { chatId: params.CHAT_ID, messageId: params.MESSAGE_ID, saved: body.result === true };
			},
		},
	],
};

