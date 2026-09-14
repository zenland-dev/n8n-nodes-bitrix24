import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { returnAllProperties } from '../../../shared/params';
import { numberProperty, positiveInt, rows } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { optionalInt, yn } from '../../../shared/values';
import {
	ATTACH_DESCRIPTION,
	chatIdProperty,
	dialogIdProperty,
	KEYBOARD_DESCRIPTION,
	MENU_DESCRIPTION,
	messageIdProperty,
	optionalJson,
	readChatId,
	readDialogId,
	valuesOf,
	withAuthorsAndFiles,
} from '../shared/helpers';

function messageId(ctx: IExecuteFunctions, itemIndex: number, name = 'messageId', label = 'Message ID'): number {
	return positiveInt(ctx, name, itemIndex, label);
}

/** Largest page im.dialog.messages.get returns. */
const MESSAGE_PAGE = 50;
/** Largest page im.dialog.messages.search returns. */
const SEARCH_PAGE = 200;
/** A runaway guard: a million messages. */
const MAX_PAGES = 20_000;

export const messageResource: Resource = {
	value: 'message',
	name: 'Message',
	description: 'Messages in chats and private dialogs, sent on behalf of the webhook user',
	operations: [
		{
			value: 'send',
			name: 'Send',
			action: 'Send a message',
			description: 'Post a message into a chat or a private dialog as the webhook user; everyone in it is notified',
			properties: [
				dialogIdProperty('Where to send'),
				{
					displayName: 'Text',
					name: 'text',
					type: 'string',
					typeOptions: { rows: 4 },
					default: '',
					description: 'Message text with BB codes: [B]bold[/B], [URL=https://example.com]link[/URL], [USER=7]name[/USER]. May be empty when an attachment is given.',
				},
				{
					displayName: 'Additional Fields',
					name: 'additionalFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [
						{ displayName: 'Attachment (JSON)', name: 'attach', type: 'json', default: '{}', description: ATTACH_DESCRIPTION },
						{ displayName: 'Context Menu (JSON)', name: 'menu', type: 'json', default: '{}', description: MENU_DESCRIPTION },
						{ displayName: 'Keyboard (JSON)', name: 'keyboard', type: 'json', default: '{}', description: KEYBOARD_DESCRIPTION },
						{ displayName: 'Link Preview', name: 'urlPreview', type: 'boolean', default: true, description: 'Whether links in the text turn into rich previews' },
						{ displayName: 'Reply to Message ID', name: 'replyId', type: 'number', default: 0, description: 'A message of the same chat this one answers' },
						{ displayName: 'System Message', name: 'system', type: 'boolean', default: false, description: 'Whether to post it as a grey system line rather than a message from the user' },
					],
				},
			],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				const text = String(this.getNodeParameter('text', itemIndex, '') ?? '');
				const o = (this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject;
				const params: IDataObject = { DIALOG_ID: dialogId };
				const attach = optionalJson(this, o.attach, 'Attachment (JSON)', itemIndex);
				if (text.trim() === '' && attach === undefined) {
					throw new NodeOperationError(this.getNode(), 'Nothing to send: give a text or an attachment', { itemIndex });
				}
				if (text.trim() !== '') params.MESSAGE = text;
				if (attach !== undefined) params.ATTACH = attach;
				const keyboard = optionalJson(this, o.keyboard, 'Keyboard (JSON)', itemIndex);
				if (keyboard !== undefined) params.KEYBOARD = keyboard;
				const menu = optionalJson(this, o.menu, 'Context Menu (JSON)', itemIndex);
				if (menu !== undefined) params.MENU = menu;
				if (o.urlPreview !== undefined) params.URL_PREVIEW = yn(o.urlPreview);
				if (o.system !== undefined) params.SYSTEM = yn(o.system);
				if (optionalInt(o.replyId) !== undefined) params.REPLY_ID = Number(o.replyId);
				const body = await bitrix24Request.call(this, 'im.message.add', params, { itemIndex });
				return { messageId: Number(body.result), dialogId };
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a message',
			description: 'Change the text, attachment, keyboard or menu of a message the webhook user sent',
			properties: [
				messageIdProperty,
				{
					displayName: 'Update Fields',
					name: 'updateFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [
						{ displayName: 'Attachment (JSON)', name: 'attach', type: 'json', default: '{}', description: `${ATTACH_DESCRIPTION} Remove Attachment takes it off` },
						{ displayName: 'Context Menu (JSON)', name: 'menu', type: 'json', default: '{}', description: MENU_DESCRIPTION },
						{ displayName: 'Keyboard (JSON)', name: 'keyboard', type: 'json', default: '{}', description: KEYBOARD_DESCRIPTION },
						{ displayName: 'Link Preview', name: 'urlPreview', type: 'boolean', default: true, description: 'Whether links in the text turn into rich previews' },
						{ displayName: 'Mark as Edited', name: 'isEdited', type: 'boolean', default: true, description: 'Whether to show the "edited" label. Bitrix24 applies it to attachment changes; a text change may be labelled anyway.' },
						{ displayName: 'Remove Attachment', name: 'removeAttach', type: 'boolean', default: true },
						{ displayName: 'Remove Context Menu', name: 'removeMenu', type: 'boolean', default: true },
						{ displayName: 'Remove Keyboard', name: 'removeKeyboard', type: 'boolean', default: true },
						{ displayName: 'Text', name: 'text', type: 'string', typeOptions: { rows: 4 }, default: '', description: 'The new text. It cannot be empty: Bitrix24 deletes a message whose text is set to nothing, so use Delete for that.' },
					],
				},
			],
			async execute(itemIndex) {
				const id = messageId(this, itemIndex);
				const o = (this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject;
				const params: IDataObject = { MESSAGE_ID: id };
				if (o.text !== undefined) {
					// An empty MESSAGE deletes the message (documented for im.message.update).
					if (String(o.text).trim() === '') throw new NodeOperationError(this.getNode(), 'Text cannot be empty: Bitrix24 would delete the message', { itemIndex, description: 'Use Message → Delete to delete it.' });
					params.MESSAGE = o.text as string;
				}
				const attach = optionalJson(this, o.attach, 'Attachment (JSON)', itemIndex);
				if (o.removeAttach === true) params.ATTACH = 'N';
				else if (attach !== undefined) params.ATTACH = attach;
				const keyboard = optionalJson(this, o.keyboard, 'Keyboard (JSON)', itemIndex);
				if (o.removeKeyboard === true) params.KEYBOARD = 'N';
				else if (keyboard !== undefined) params.KEYBOARD = keyboard;
				const menu = optionalJson(this, o.menu, 'Context Menu (JSON)', itemIndex);
				if (o.removeMenu === true) params.MENU = 'N';
				else if (menu !== undefined) params.MENU = menu;
				if (o.urlPreview !== undefined) params.URL_PREVIEW = yn(o.urlPreview);
				if (o.isEdited !== undefined) params.IS_EDITED = yn(o.isEdited);
				if (Object.keys(params).length === 1) throw new NodeOperationError(this.getNode(), 'Nothing to update: add at least one field', { itemIndex });
				await bitrix24Request.call(this, 'im.message.update', params, { itemIndex });
				return { messageId: id, updated: true };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a message',
			description: 'Delete a message the webhook user sent, or any message in a group chat it administers',
			properties: [messageIdProperty],
			async execute(itemIndex) {
				const id = messageId(this, itemIndex);
				await bitrix24Request.call(this, 'im.message.delete', { MESSAGE_ID: id }, { itemIndex });
				return { messageId: id, deleted: true };
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get messages of a chat',
			description: 'Read the messages of a chat the webhook user is in: the latest, older than a message, or newer than a message',
			properties: [
				dialogIdProperty(),
				{
					displayName: 'Read',
					name: 'direction',
					type: 'options',
					default: 'latest',
					options: [
						{ name: 'Latest', value: 'latest', description: 'The newest messages, then older ones' },
						{ name: 'Newer Than a Message', value: 'after', description: 'Messages after the given one, oldest first' },
						{ name: 'Older Than a Message', value: 'before', description: 'Messages before the given one, newest first' },
					],
				},
				{ ...messageIdProperty, displayName: 'From Message ID', name: 'fromMessageId', displayOptions: { show: { direction: ['before', 'after'] } }, description: 'The message to count from; it is not included' },
				...returnAllProperties('messages'),
				{ displayName: 'Include Authors and Files', name: 'join', type: 'boolean', default: true, description: 'Whether to put the author and the attached files on each message instead of leaving them out' },
			],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				const direction = this.getNodeParameter('direction', itemIndex) as string;
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? Infinity : (this.getNodeParameter('limit', itemIndex) as number);
				const join = this.getNodeParameter('join', itemIndex, true) === true;
				let cursor = direction === 'latest' ? undefined : messageId(this, itemIndex, 'fromMessageId', 'From Message ID');
				const forward = direction === 'after';
				const out: IDataObject[] = [];
				const seen = new Set<number>();

				for (let page = 0; page < MAX_PAGES && out.length < limit; page++) {
					const params: IDataObject = { DIALOG_ID: dialogId, LIMIT: MESSAGE_PAGE };
					if (cursor !== undefined) params[forward ? 'FIRST_ID' : 'LAST_ID'] = cursor;
					const body = await bitrix24Request.call(this, 'im.dialog.messages.get', params, { itemIndex });
					const result = (body.result ?? {}) as IDataObject;
					const messages = valuesOf(result.messages).filter((m) => !seen.has(Number(m.id)));
					if (messages.length === 0) break;
					const ordered = messages.sort((a, b) => (forward ? Number(a.id) - Number(b.id) : Number(b.id) - Number(a.id)));
					for (const m of ordered) seen.add(Number(m.id));
					out.push(...(join ? withAuthorsAndFiles(ordered, result.users, result.files) : ordered));
					cursor = Number(ordered[ordered.length - 1].id);
					// The latest page may carry more than LIMIT when there are unread messages; a short page ends the history.
					if (messages.length < MESSAGE_PAGE) break;
				}
				return out.slice(0, limit);
			},
		},
		{
			value: 'search',
			name: 'Search',
			action: 'Search messages in a chat',
			description: 'Find messages in one chat by text and date',
			properties: [
				chatIdProperty('The chat to search in'),
				{ displayName: 'Search Text', name: 'text', type: 'string', default: '', description: 'Searched when longer than 2 characters. Leave empty to filter by date only.' },
				...returnAllProperties('messages'),
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: [
						{ displayName: 'Date From', name: 'dateFrom', type: 'dateTime', default: '' },
						{ displayName: 'Date To', name: 'dateTo', type: 'dateTime', default: '' },
						{ displayName: 'Oldest First', name: 'ascending', type: 'boolean', default: true, description: 'Whether to return the oldest messages first instead of the newest' },
						{ displayName: 'On Date', name: 'date', type: 'dateTime', default: '', description: 'The 24 hours starting at this moment' },
					],
				},
			],
			async execute(itemIndex) {
				const chatId = readChatId(this, itemIndex);
				const text = String(this.getNodeParameter('text', itemIndex, '') ?? '').trim();
				const f = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? Infinity : (this.getNodeParameter('limit', itemIndex) as number);
				const base: IDataObject = { CHAT_ID: chatId, ORDER: { ID: f.ascending === true ? 'ASC' : 'DESC' } };
				if (text !== '') base.SEARCH_MESSAGE = text;
				if (f.dateFrom) base.DATE_FROM = f.dateFrom as string;
				if (f.dateTo) base.DATE_TO = f.dateTo as string;
				if (f.date) base.DATE = f.date as string;
				if (Object.keys(base).length === 2) throw new NodeOperationError(this.getNode(), 'Give a search text or a date filter', { itemIndex });
				const out: IDataObject[] = [];
				let lastId: number | undefined;
				for (let page = 0; page < MAX_PAGES && out.length < limit; page++) {
					const params = { ...base, LIMIT: SEARCH_PAGE, ...(lastId === undefined ? {} : { LAST_ID: lastId }) };
					const body = await bitrix24Request.call(this, 'im.dialog.messages.search', params, { itemIndex });
					const result = (body.result ?? {}) as IDataObject;
					const messages = valuesOf(result.messages);
					out.push(...withAuthorsAndFiles(messages, result.users, result.files));
					if (messages.length < SEARCH_PAGE) break;
					const nextId = Number(messages[messages.length - 1].id);
					if (!Number.isFinite(nextId) || nextId === lastId) break;
					lastId = nextId;
				}
				return out.slice(0, limit);
			},
		},
		{
			value: 'like',
			name: 'Like',
			action: 'Like a message',
			description: 'Put or take off the webhook user\'s like on a message',
			properties: [
				messageIdProperty,
				{
					displayName: 'Action',
					name: 'likeAction',
					type: 'options',
					default: 'plus',
					options: [
						{ name: 'Like', value: 'plus' },
						{ name: 'Remove Like', value: 'minus' },
						{ name: 'Toggle', value: 'auto' },
					],
				},
			],
			async execute(itemIndex) {
				const id = messageId(this, itemIndex);
				const action = this.getNodeParameter('likeAction', itemIndex) as string;
				await bitrix24Request.call(this, 'im.message.like', { MESSAGE_ID: id, ACTION: action }, { itemIndex });
				return { messageId: id, action };
			},
		},
		{
			value: 'createObject',
			name: 'Create Object From Message',
			action: 'Create a task, post, event or chat from a message',
			description: 'Turn a message into a task, a feed post, a calendar event or a new chat, as the message menu does',
			properties: [
				messageIdProperty,
				dialogIdProperty('The chat the message is in'),
				{
					displayName: 'Create',
					name: 'objectType',
					type: 'options',
					default: 'TASK',
					options: [
						{ name: 'Calendar Event', value: 'CALEND' },
						{ name: 'Chat', value: 'CHAT' },
						{ name: 'Feed Post', value: 'POST' },
						{ name: 'Task', value: 'TASK' },
					],
				},
			],
			async execute(itemIndex) {
				const params = { MESSAGE_ID: messageId(this, itemIndex), DIALOG_ID: readDialogId(this, itemIndex), TYPE: this.getNodeParameter('objectType', itemIndex) as string };
				const body = await bitrix24Request.call(this, 'im.message.share', params, { itemIndex });
				return { messageId: params.MESSAGE_ID, created: params.TYPE, success: body.result === true };
			},
		},
		{
			value: 'runBotCommand',
			name: 'Run Bot Command',
			action: 'Run a chatbot command on a message',
			description: 'Run a command of a chatbot in the context of a message, as pressing its button would',
			properties: [
				messageIdProperty,
				numberProperty('Bot ID', 'botId', 'The chatbot that owns the command'),
				{ displayName: 'Command', name: 'command', type: 'string', required: true, default: '', placeholder: 'help', description: 'The command as the bot registered it' },
				{ displayName: 'Command Parameters', name: 'commandParams', type: 'string', default: '' },
			],
			async execute(itemIndex) {
				const params: IDataObject = {
					MESSAGE_ID: messageId(this, itemIndex),
					BOT_ID: positiveInt(this, 'botId', itemIndex, 'Bot ID'),
					COMMAND: String(this.getNodeParameter('command', itemIndex)).trim(),
				};
				const commandParams = String(this.getNodeParameter('commandParams', itemIndex, '') ?? '');
				if (commandParams !== '') params.COMMAND_PARAMS = commandParams;
				const body = await bitrix24Request.call(this, 'im.message.command', params, { itemIndex });
				return { messageId: params.MESSAGE_ID, command: params.COMMAND, success: body.result === true };
			},
		},
		{
			value: 'markRead',
			name: 'Mark as Read',
			action: 'Mark messages as read',
			description: 'Mark the messages of a conversation as read by the webhook user, all of them or up to a message',
			properties: [dialogIdProperty(), { displayName: 'Up to Message ID', name: 'upToMessageId', type: 'number', default: 0, description: 'The last message to mark, inclusive. 0 marks every unread message.' }],
			async execute(itemIndex) {
				const params: IDataObject = { DIALOG_ID: readDialogId(this, itemIndex) };
				const upTo = optionalInt(this.getNodeParameter('upToMessageId', itemIndex, 0));
				if (upTo !== undefined) params.MESSAGE_ID = upTo;
				const body = await bitrix24Request.call(this, 'im.dialog.read', params, { itemIndex });
				if (body.result === false) throw new NodeOperationError(this.getNode(), `The webhook user has no access to ${params.DIALOG_ID as string}`, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'markUnread',
			name: 'Mark as Unread',
			action: 'Mark messages as unread',
			description: 'Mark the messages of a conversation as unread by the webhook user, starting from a message',
			properties: [dialogIdProperty(), { ...messageIdProperty, displayName: 'From Message ID', name: 'fromMessageId', description: 'The first message to mark unread; later ones follow' }],
			async execute(itemIndex) {
				const params = { DIALOG_ID: readDialogId(this, itemIndex), MESSAGE_ID: messageId(this, itemIndex, 'fromMessageId', 'From Message ID') };
				await bitrix24Request.call(this, 'im.dialog.unread', params, { itemIndex });
				return { dialogId: params.DIALOG_ID, unreadFrom: params.MESSAGE_ID };
			},
		},
		{
			value: 'markAllRead',
			name: 'Mark All as Read',
			action: 'Mark every conversation as read',
			description: 'Mark every message in every conversation of the webhook user as read',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'im.dialog.read.all', {}, { itemIndex });
				return { success: body.result === true };
			},
		},
		{
			value: 'sendTyping',
			name: 'Send Typing Indicator',
			action: 'Show that the webhook user is typing',
			description: 'Show "typing…" in a conversation for a few seconds, e.g. while a workflow prepares an answer',
			properties: [dialogIdProperty()],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				await bitrix24Request.call(this, 'im.dialog.writing', { DIALOG_ID: dialogId }, { itemIndex });
				return { dialogId, typing: true };
			},
		},
	],
};
