import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, randomInt } from 'n8n-workflow';

import { normalizeBotToken } from '../../../credentials/portalAddress';
import { ATTACH_DESCRIPTION, optionalJson } from '../../../shared/messages';
import type { Bitrix24Context } from '../../../shared/transport';
import { bitrix24Request, CHATBOT_CREDENTIAL } from '../../../shared/transport';
import { idList, optionalInt } from '../../../shared/values';
import { binaryAsBase64 } from '../../Bitrix24Messenger/shared/helpers';

export { ATTACH_DESCRIPTION };

/** Where the bot token goes: top level for every call, inside `fields` for Bot.register. */
type TokenPlace = 'top' | 'fields';

/**
 * One `imbot.v2` call on behalf of the bot in the credential.
 *
 * Through a webhook Bitrix24 names the bot by `botToken`, and a wrong or missing token is
 * `BOT_OWNERSHIP_ERROR` or `BOT_TOKEN_NOT_SPECIFIED`, so the token is checked here before
 * a request leaves. It is added to the body only: never to the URL, output or errors.
 */
export async function botRequest(
	this: Bitrix24Context,
	method: string,
	params: IDataObject,
	itemIndex?: number,
	tokenPlace: TokenPlace = 'top',
): Promise<IDataObject> {
	const credentials = await this.getCredentials(CHATBOT_CREDENTIAL);
	const botToken = normalizeBotToken(credentials.botToken);
	if (botToken === '') {
		throw new NodeOperationError(this.getNode(), 'The Bot Token in the credential is empty or longer than 40 characters', {
			itemIndex,
			description: 'Bitrix24 accepts a bot token of up to 40 characters. Put the token the bot was registered with into the Bitrix24 Chatbot Webhook API credential.',
		});
	}
	const body =
		tokenPlace === 'fields'
			? { ...params, fields: { ...((params.fields as IDataObject | undefined) ?? {}), botToken } }
			: { ...params, botToken };
	return await bitrix24Request.call(this, method, body, { itemIndex, credentialType: CHATBOT_CREDENTIAL });
}

/** A call that needs no bot, such as Revision.get: the token is not sent at all. */
export async function portalRequest(this: Bitrix24Context, method: string, itemIndex?: number): Promise<IDataObject> {
	return await bitrix24Request.call(this, method, {}, { itemIndex, credentialType: CHATBOT_CREDENTIAL });
}

export const botIdProperty: INodeProperties = {
	displayName: 'Bot Name or ID',
	name: 'botId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getBots' },
	required: true,
	default: '',
	description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	hint: 'Bots registered with the Bot Token of the credential. Bot → Register adds one.',
};

export function readBotId(ctx: IExecuteFunctions, itemIndex: number): number {
	const id = Number(ctx.getNodeParameter('botId', itemIndex));
	if (!Number.isInteger(id) || id <= 0) {
		throw new NodeOperationError(ctx.getNode(), 'Bot: pick a bot or give its numeric ID', { itemIndex, description: 'Bot → Get Many lists the bots of this credential.' });
	}
	return id;
}

/** imbot.v2 addresses a conversation as `chat123` or, for a private chat, the other person's user ID. */
export function dialogIdProperty(description = 'The conversation'): INodeProperties {
	return {
		displayName: 'Dialog ID',
		name: 'dialogId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'chat123',
		description: `${description}: chat123 for group chat 123, or a user ID such as 7 for the private chat of the bot with that user. Events carry it as chat.dialogId.`,
	};
}

export function readDialogId(ctx: IExecuteFunctions, itemIndex: number): string {
	const text = String(ctx.getNodeParameter('dialogId', itemIndex) ?? '').trim();
	if (/^[1-9]\d*$/.test(text)) return text;
	const match = text.match(/^chat([1-9]\d*)$/i);
	if (match) return `chat${match[1]}`;
	throw new NodeOperationError(ctx.getNode(), `Dialog ID "${text}" is not chat123 or a user ID`, {
		itemIndex,
		description: 'A group chat is chat plus its ID; a private chat is the user ID of the person the bot talks to.',
	});
}

export function messageIdProperty(description = 'ID of the message'): INodeProperties {
	return { displayName: 'Message ID', name: 'messageId', type: 'number', required: true, default: 0, description };
}

export function readPositive(ctx: IExecuteFunctions, name: string, itemIndex: number, label: string): number {
	const value = Number(ctx.getNodeParameter(name, itemIndex));
	if (!Number.isInteger(value) || value <= 0) {
		throw new NodeOperationError(ctx.getNode(), `${label} must be a positive whole number`, { itemIndex });
	}
	return value;
}

export function readUserIds(ctx: IExecuteFunctions, itemIndex: number, name = 'userIds', label = 'User IDs'): number[] {
	const ids = idList(ctx, ctx.getNodeParameter(name, itemIndex), label, itemIndex);
	if (ids.length === 0) throw new NodeOperationError(ctx.getNode(), `${label}: give at least one user ID`, { itemIndex });
	return ids;
}

/** The colour codes imbot.v2 takes for bot avatars and chats. */
export const COLOR_OPTIONS = [
	{ name: 'Aqua', value: 'aqua' },
	{ name: 'Azure', value: 'azure' },
	{ name: 'Brown', value: 'brown' },
	{ name: 'Dark Blue', value: 'darkBlue' },
	{ name: 'Graphite', value: 'graphite' },
	{ name: 'Gray', value: 'gray' },
	{ name: 'Green', value: 'green' },
	{ name: 'Khaki', value: 'khaki' },
	{ name: 'Light Blue', value: 'lightBlue' },
	{ name: 'Lime', value: 'lime' },
	{ name: 'Marengo', value: 'marengo' },
	{ name: 'Mint', value: 'mint' },
	{ name: 'Pink', value: 'pink' },
	{ name: 'Purple', value: 'purple' },
	{ name: 'Red', value: 'red' },
	{ name: 'Sand', value: 'sand' },
];

/** An image from the input binary data as the bare base64 Bitrix24 wants for avatars. */
export async function avatarFrom(ctx: IExecuteFunctions, itemIndex: number, property: unknown): Promise<string | undefined> {
	const name = String(property ?? '').trim();
	if (name === '') return undefined;
	const file = await binaryAsBase64(ctx, itemIndex, name);
	if (!String(file.mimeType ?? '').startsWith('image/')) {
		throw new NodeOperationError(ctx.getNode(), `Avatar: binary field "${name}" is ${file.mimeType || 'not an image'}, not an image`, { itemIndex });
	}
	return file.content;
}

export const KEYBOARD_DESCRIPTION =
	'Buttons under the message, e.g. {"BUTTONS": [{"TEXT": "Help", "COMMAND": "help", "BLOCK": "Y"}, {"TYPE": "NEWLINE"}, {"TEXT": "Open site", "LINK": "https://example.com"}]}. A COMMAND button runs a command registered with Command → Register and arrives as a Command Called event. A bare array of buttons works too.';

/**
 * A keyboard as Bitrix24 routes it: the documentation asks for BOT_ID next to BUTTONS,
 * or a button press "may not be routed to the correct bot". Added unless given.
 */
export function keyboardFor(ctx: IExecuteFunctions, raw: unknown, botId: number, itemIndex: number): IDataObject | undefined {
	const value = optionalJson(ctx, raw, 'Keyboard (JSON)', itemIndex);
	if (value === undefined) return undefined;
	const keyboard: IDataObject = Array.isArray(value) ? { BUTTONS: value } : { ...value };
	if (keyboard.BUTTONS === undefined) {
		throw new NodeOperationError(ctx.getNode(), 'Keyboard (JSON) needs a BUTTONS array, or a bare array of buttons', { itemIndex });
	}
	if (keyboard.BOT_ID === undefined) keyboard.BOT_ID = botId;
	return keyboard;
}

/** Message options shared by Send, Command → Answer and Update. */
export function messageOptionProperties(kind: 'send' | 'answer'): INodeProperties[] {
	const options: INodeProperties[] = [
		{ displayName: 'Attachment (JSON)', name: 'attach', type: 'json', default: '{}', description: ATTACH_DESCRIPTION },
		{ displayName: 'Keyboard (JSON)', name: 'keyboard', type: 'json', default: '{}', description: KEYBOARD_DESCRIPTION },
		{ displayName: 'Link Preview', name: 'urlPreview', type: 'boolean', default: true, description: 'Whether links in the text turn into rich previews' },
		{ displayName: 'System Message', name: 'system', type: 'boolean', default: false, description: 'Whether to post a grey system line instead of a message from the bot. The bot cannot edit such a line later, nor delete it unless it administers the chat.' },
	];
	if (kind === 'send') {
		options.push(
			{ displayName: 'Forward Message IDs', name: 'forwardIds', type: 'string', default: '', placeholder: '101, 102', description: 'Messages to forward with this one, up to 100, from chats the bot is in' },
			{ displayName: 'Reply to Message ID', name: 'replyId', type: 'number', default: 0, description: 'A message this one answers, shown quoted above it' },
		);
	}
	return [
		{
			displayName: 'Text',
			name: 'text',
			type: 'string',
			typeOptions: { rows: 4 },
			default: '',
			description: 'Message text with BB codes: [B]bold[/B], [URL=https://example.com]link[/URL], [USER=7]name[/USER]. Up to 20 000 characters. May be empty when an attachment is given.',
		},
		{ displayName: 'Additional Fields', name: 'additionalFields', type: 'collection', placeholder: 'Add Field', default: {}, options: options.sort((a, b) => a.displayName.localeCompare(b.displayName)) },
	];
}

/** A random RFC 4122 version 4 UUID, the key form Chat.Message.send wants for forwards. */
function uuid(): string {
	const hex = Array.from({ length: 32 }, () => randomInt(16).toString(16));
	hex[12] = '4';
	hex[16] = (8 + randomInt(4)).toString(16);
	const s = hex.join('');
	return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** The `fields` of a message from the Text and Additional Fields parameters. */
export function messageFields(ctx: IExecuteFunctions, itemIndex: number, botId: number): IDataObject {
	const text = String(ctx.getNodeParameter('text', itemIndex, '') ?? '');
	const o = (ctx.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject;
	const fields: IDataObject = {};
	const attach = optionalJson(ctx, o.attach, 'Attachment (JSON)', itemIndex);
	const forward = o.forwardIds === undefined ? [] : idList(ctx, o.forwardIds, 'Forward Message IDs', itemIndex);
	if (forward.length > 100) throw new NodeOperationError(ctx.getNode(), 'Forward Message IDs: Bitrix24 forwards at most 100 messages at once', { itemIndex });
	if (text.trim() === '' && attach === undefined && forward.length === 0) {
		throw new NodeOperationError(ctx.getNode(), 'Nothing to send: give a text, an attachment or messages to forward', { itemIndex });
	}
	if (text.trim() !== '') fields.message = text;
	if (attach !== undefined) fields.attach = attach;
	const keyboard = keyboardFor(ctx, o.keyboard, botId, itemIndex);
	if (keyboard !== undefined) fields.keyboard = keyboard;
	if (o.urlPreview !== undefined) fields.urlPreview = o.urlPreview === true;
	if (o.system !== undefined) fields.system = o.system === true;
	if (optionalInt(o.replyId) !== undefined) fields.replyId = Number(o.replyId);
	if (forward.length > 0) fields.forwardIds = Object.fromEntries(forward.map((id) => [uuid(), id]));
	return fields;
}

/** A bot with its user profile, which Bitrix24 returns in a separate `users` list. */
export function withProfile(bot: unknown, users: unknown): IDataObject {
	const b = (bot ?? {}) as IDataObject;
	const list = Array.isArray(users) ? (users as IDataObject[]) : [];
	return { ...b, profile: list.find((u) => Number(u.id) === Number(b.id)) ?? null };
}

/** Messages with their `author` joined in from the `users` list next to them. */
export function withAuthors(messages: unknown, users: unknown): IDataObject[] {
	const list = Array.isArray(users) ? (users as IDataObject[]) : [];
	const byId = new Map(list.map((u) => [Number(u.id), u]));
	return (Array.isArray(messages) ? (messages as IDataObject[]) : []).map((m) => ({ ...m, author: byId.get(Number(m.authorId)) ?? null }));
}

/**
 * A command title or hint in Bitrix24's `{langCode: text}` form: the text under its
 * language, over whatever other translations the JSON field gave.
 */
export function localized(language: unknown, text: unknown, translations: IDataObject | undefined): IDataObject | undefined {
	const out: IDataObject = { ...(translations ?? {}) };
	const lang = String(language ?? '').trim().toLowerCase() || 'en';
	if (text !== undefined && String(text) !== '') out[lang] = String(text);
	return Object.keys(out).length > 0 ? out : undefined;
}
