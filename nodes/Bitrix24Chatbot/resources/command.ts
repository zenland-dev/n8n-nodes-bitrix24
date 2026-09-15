import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { jsonValue } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import {
	botIdProperty,
	botRequest,
	dialogIdProperty,
	localized,
	messageFields,
	messageIdProperty,
	messageOptionProperties,
	readBotId,
	readDialogId,
	readPositive,
} from '../shared/bot';

const commandIdProperty: INodeProperties = { displayName: 'Command ID', name: 'commandId', type: 'number', required: true, default: 0, description: 'ID of the command, as Register and Get Many return it; a Command Called event carries it inside its command object' };

/** `/help` and `help` are the same command; Bitrix24 wants it without the slash. */
function commandName(ctx: IExecuteFunctions, raw: unknown, itemIndex: number): string {
	const name = String(raw ?? '').trim().replace(/^\/+/, '');
	if (name === '' || /\s/.test(name)) throw new NodeOperationError(ctx.getNode(), 'Command must be one word, such as help', { itemIndex });
	return name;
}

const settingOptions: INodeProperties[] = [
	{ displayName: 'Available in All Chats', name: 'common', type: 'boolean', default: false, description: 'Whether the command works in any chat, not only in the private chat with the bot and chats the bot is in' },
	{ displayName: 'Extranet Users', name: 'extranetSupport', type: 'boolean', default: false, description: 'Whether extranet users can call the command' },
	{ displayName: 'Hidden', name: 'hidden', type: 'boolean', default: false, description: 'Whether to leave the command out of the command list; it still runs when typed or pressed' },
	{ displayName: 'Language', name: 'language', type: 'string', default: 'en', description: 'Two-letter code of the language Title and Parameters Hint are in' },
	{ displayName: 'Parameters Hint', name: 'params', type: 'string', default: '', placeholder: 'question text', description: 'What to type after the command, shown next to it' },
	{ displayName: 'Translations (JSON)', name: 'translations', type: 'json', default: '{}', description: 'Titles and hints in other languages: {"title": {"de": "Hilfe"}, "params": {"de": "Frage"}}. In Update, null removes a translation.' },
];

/** Title, hint and flags in the `fields` form Command.register and Command.update take. */
function commandSettings(ctx: IExecuteFunctions, itemIndex: number, o: IDataObject, title: unknown): IDataObject {
	const fields: IDataObject = {};
	const translations = jsonValue<IDataObject>(ctx, o.translations, 'Translations (JSON)', itemIndex, {});
	const titles = localized(o.language, title, translations.title as IDataObject | undefined);
	if (titles !== undefined) fields.title = titles;
	const hints = localized(o.language, o.params, translations.params as IDataObject | undefined);
	if (hints !== undefined) fields.params = hints;
	for (const key of ['common', 'hidden', 'extranetSupport'] as const) if (o[key] !== undefined) fields[key] = o[key] === true;
	return fields;
}

export const commandResource: Resource = {
	value: 'command',
	name: 'Command',
	description: 'Slash commands of the bot and answers to them',
	operations: [
		{
			value: 'register',
			name: 'Register',
			action: 'Register a slash command',
			description: 'Add a slash command such as /help to the bot. Calls and keyboard presses arrive as Command Called events. Repeating it returns the existing command unchanged.',
			properties: [
				botIdProperty,
				{ displayName: 'Command', name: 'command', type: 'string', required: true, default: '', placeholder: 'help', description: 'The command without the slash' },
				{ displayName: 'Title', name: 'title', type: 'string', default: '', description: 'What the command does, shown in the command list. Required unless the command is hidden.' },
				{ displayName: 'Additional Fields', name: 'additionalFields', type: 'collection', placeholder: 'Add Field', default: {}, options: settingOptions },
			],
			async execute(itemIndex) {
				const botId = readBotId(this, itemIndex);
				const o = (this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject;
				const fields: IDataObject = { command: commandName(this, this.getNodeParameter('command', itemIndex), itemIndex), ...commandSettings(this, itemIndex, o, this.getNodeParameter('title', itemIndex, '')) };
				if (fields.title === undefined && o.hidden !== true) {
					throw new NodeOperationError(this.getNode(), 'Title is required for a command that is not hidden', { itemIndex });
				}
				const body = await botRequest.call(this, 'imbot.v2.Command.register', { botId, fields }, itemIndex);
				return ((body.result as IDataObject | null)?.command ?? {}) as IDataObject;
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a slash command',
			description: 'Rename a command of the bot, or change its title, hint and where it is available',
			properties: [
				botIdProperty,
				commandIdProperty,
				{
					displayName: 'Update Fields',
					name: 'updateFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [
						...settingOptions,
						{ displayName: 'Command', name: 'command', type: 'string', default: '', placeholder: 'help', description: 'The new command, without the slash' },
						{ displayName: 'Title', name: 'title', type: 'string', default: '' },
					].sort((a, b) => a.displayName.localeCompare(b.displayName)) as INodeProperties[],
				},
			],
			async execute(itemIndex) {
				const botId = readBotId(this, itemIndex);
				const commandId = readPositive(this, 'commandId', itemIndex, 'Command ID');
				const o = (this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject;
				const fields = commandSettings(this, itemIndex, o, o.title);
				if (o.command !== undefined) fields.command = commandName(this, o.command, itemIndex);
				if (Object.keys(fields).length === 0) throw new NodeOperationError(this.getNode(), 'Nothing to update: add at least one field', { itemIndex });
				const body = await botRequest.call(this, 'imbot.v2.Command.update', { botId, commandId, fields }, itemIndex);
				return ((body.result as IDataObject | null)?.command ?? {}) as IDataObject;
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the slash commands of a bot',
			description: 'List the commands of the bot with their titles and hints in the portal language',
			properties: [
				botIdProperty,
				{ displayName: 'Include Built-In Commands', name: 'includeBuiltIn', type: 'boolean', default: false, description: 'Whether to add the messenger\'s own commands such as /me, which Bitrix24 lists with bot ID 0' },
			],
			async execute(itemIndex) {
				const botId = readBotId(this, itemIndex);
				const body = await botRequest.call(this, 'imbot.v2.Command.list', { botId }, itemIndex);
				const commands = (body.result as IDataObject | null)?.commands;
				const all = Array.isArray(commands) ? (commands as IDataObject[]) : [];
				// On a live portal the list held six built-in commands (botId 0) next to the bot's own.
				const includeBuiltIn = this.getNodeParameter('includeBuiltIn', itemIndex, false) === true;
				return all.filter((c) => Number(c.botId) === botId || (includeBuiltIn && Number(c.botId) === 0));
			},
		},
		{
			value: 'unregister',
			name: 'Unregister',
			action: 'Delete a slash command',
			description: 'Delete a command of the bot',
			properties: [botIdProperty, commandIdProperty],
			async execute(itemIndex) {
				const commandId = readPositive(this, 'commandId', itemIndex, 'Command ID');
				const body = await botRequest.call(this, 'imbot.v2.Command.unregister', { botId: readBotId(this, itemIndex), commandId }, itemIndex);
				return { commandId, unregistered: (body.result as IDataObject | null)?.result === true };
			},
		},
		{
			value: 'answer',
			name: 'Answer',
			action: 'Answer a slash command',
			description: 'Reply to a command call in the chat it came from, even one the bot is not in (then as a system line with the bot\'s name)',
			properties: [
				botIdProperty,
				commandIdProperty,
				messageIdProperty('ID of the message that called the command: message.id of the Command Called event'),
				dialogIdProperty('The chat the command was called in'),
				...messageOptionProperties('answer'),
			],
			async execute(itemIndex) {
				const botId = readBotId(this, itemIndex);
				const params = {
					botId,
					commandId: readPositive(this, 'commandId', itemIndex, 'Command ID'),
					messageId: readPositive(this, 'messageId', itemIndex, 'Message ID'),
					dialogId: readDialogId(this, itemIndex),
					fields: messageFields(this, itemIndex, botId),
				};
				const body = await botRequest.call(this, 'imbot.v2.Command.answer', params, itemIndex);
				return { commandId: params.commandId, dialogId: params.dialogId, answered: (body.result as IDataObject | null)?.result === true };
			},
		},
	],
};
