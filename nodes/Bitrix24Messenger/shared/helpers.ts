import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { valuesOf } from '../../../shared/offset';

export { ATTACH_DESCRIPTION, KEYBOARD_DESCRIPTION, MENU_DESCRIPTION, optionalJson } from '../../../shared/messages';
export { offsetList, valuesOf } from '../../../shared/offset';

/**
 * A dialog is named three ways in the messenger API: `chat123` for a group chat,
 * `sg12` for the chat of workgroup 12, and a bare user ID for a private chat with
 * that user. The placeholder keeps the offline dry run on a valid value.
 */
export function dialogIdProperty(description = 'The conversation'): INodeProperties {
	return {
		displayName: 'Dialog ID',
		name: 'dialogId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'chat123',
		description: `${description}: chat123 for a group chat, sg12 for the chat of workgroup 12, or a user ID such as 7 for the private chat with that user`,
	};
}

export function readDialogId(ctx: IExecuteFunctions, itemIndex: number, name = 'dialogId'): string {
	const text = String(ctx.getNodeParameter(name, itemIndex) ?? '').trim();
	if (/^[1-9]\d*$/.test(text)) return text;
	const match = text.match(/^(chat|sg)([1-9]\d*)$/i);
	if (match) return `${match[1].toLowerCase()}${match[2]}`;
	throw new NodeOperationError(ctx.getNode(), `Dialog ID "${text}" is not chat123, sg12 or a user ID`, {
		itemIndex,
		description: 'A group chat is chat plus its ID, a workgroup chat is sg plus the group ID, a private chat is the other person\'s user ID.',
	});
}

/** A group chat by number; `chat123` is accepted too, since that is how dialog IDs spell it. */
export function chatIdProperty(description = 'The group chat'): INodeProperties {
	return {
		displayName: 'Chat ID',
		name: 'chatId',
		type: 'string',
		required: true,
		default: '',
		placeholder: '123',
		description: `${description}. A number, or the dialog ID form chat123.`,
	};
}

export function readChatId(ctx: IExecuteFunctions, itemIndex: number, name = 'chatId', label = 'Chat ID'): number {
	const text = String(ctx.getNodeParameter(name, itemIndex) ?? '').trim().replace(/^chat/i, '');
	const id = Number(text);
	if (!Number.isInteger(id) || id <= 0) {
		throw new NodeOperationError(ctx.getNode(), `${label} must be a chat number such as 123 or chat123`, { itemIndex });
	}
	return id;
}

export const messageIdProperty: INodeProperties = {
	displayName: 'Message ID',
	name: 'messageId',
	type: 'number',
	required: true,
	default: 0,
	description: 'ID of the message, as Send returns it or Get Many lists it',
};

export const COLOR_OPTIONS = [
	{ name: 'Aqua', value: 'AQUA' },
	{ name: 'Azure', value: 'AZURE' },
	{ name: 'Brown', value: 'BROWN' },
	{ name: 'Dark Blue', value: 'DARK_BLUE' },
	{ name: 'Graphite', value: 'GRAPHITE' },
	{ name: 'Gray', value: 'GRAY' },
	{ name: 'Green', value: 'GREEN' },
	{ name: 'Khaki', value: 'KHAKI' },
	{ name: 'Light Blue', value: 'LIGHT_BLUE' },
	{ name: 'Lime', value: 'LIME' },
	{ name: 'Marengo', value: 'MARENGO' },
	{ name: 'Mint', value: 'MINT' },
	{ name: 'Pink', value: 'PINK' },
	{ name: 'Purple', value: 'PURPLE' },
	{ name: 'Red', value: 'RED' },
	{ name: 'Sand', value: 'SAND' },
];

/** Reads the chosen binary property into base64, with the file name and MIME type n8n kept. */
export async function binaryAsBase64(ctx: IExecuteFunctions, itemIndex: number, propertyName: string): Promise<{ content: string; fileName: string; mimeType: string }> {
	const binary = ctx.helpers.assertBinaryData(itemIndex, propertyName);
	const buffer = await ctx.helpers.getBinaryDataBuffer(itemIndex, propertyName);
	return { content: buffer.toString('base64'), fileName: binary.fileName ?? 'file', mimeType: binary.mimeType };
}

/** Joins the users and files a message list returns separately onto each message. */
export function withAuthorsAndFiles(messages: IDataObject[], users: unknown, files: unknown): IDataObject[] {
	const userById = new Map(valuesOf(users).map((u) => [Number(u.id), u]));
	const fileById = new Map(valuesOf(files).map((f) => [Number(f.id), f]));
	return messages.map((message) => {
		const params = (message.params ?? {}) as IDataObject;
		const fileIds = Array.isArray(params.FILE_ID) ? (params.FILE_ID as unknown[]).map(Number) : [];
		const authorId = Number(message.author_id ?? message.authorId);
		const out: IDataObject = { ...message };
		if (authorId > 0 && userById.has(authorId)) out.author = userById.get(authorId) as IDataObject;
		if (fileIds.length > 0) out.files = fileIds.map((id) => fileById.get(id) ?? { id });
		return out;
	});
}
