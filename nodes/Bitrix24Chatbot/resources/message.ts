import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { optionalJson } from '../../../shared/messages';
import type { Resource } from '../../../shared/spec';
import { optionalInt } from '../../../shared/values';
import {
	ATTACH_DESCRIPTION,
	botIdProperty,
	botRequest,
	dialogIdProperty,
	KEYBOARD_DESCRIPTION,
	keyboardFor,
	messageFields,
	messageIdProperty,
	messageOptionProperties,
	readBotId,
	readDialogId,
	readPositive,
	withAuthors,
} from '../shared/bot';

/** Reaction codes of Chat.Message.Reaction.add, 14.09.2026. Bitrix24 may change the list. */
const REACTION_OPTIONS = [
	{ name: 'Admiring', value: 'kiss' },
	{ name: 'All Good', value: 'loveYouGesture' },
	{ name: 'Angry', value: 'angry' },
	{ name: 'Attention', value: 'exclamationMark' },
	{ name: 'Awesome', value: 'clappingHands' },
	{ name: 'Beautiful', value: 'smilingFaceWithHeartEyes' },
	{ name: 'Begging', value: 'pleadingFace' },
	{ name: 'Bomb', value: 'bomb' },
	{ name: 'Cancel', value: 'crossMark' },
	{ name: 'Clown', value: 'clownFace' },
	{ name: 'Congratulations', value: 'partyingFace' },
	{ name: 'Cool', value: 'smilingFaceWithSunglasses' },
	{ name: 'Crying', value: 'loudlyCryingFace' },
	{ name: 'Deal', value: 'handshake' },
	{ name: 'Dislike', value: 'dislike' },
	{ name: 'Done', value: 'whiteHeavyCheckMark' },
	{ name: 'Doubting', value: 'thinkingFace' },
	{ name: 'Embarrassed', value: 'flushedFace' },
	{ name: 'Eyes', value: 'eyes' },
	{ name: 'Fire', value: 'fire' },
	{ name: 'Frowning', value: 'slightlyFrowningFace' },
	{ name: 'Heart', value: 'redHeart' },
	{ name: 'High Five', value: 'raisedHand' },
	{ name: 'Idea', value: 'lightBulb' },
	{ name: 'Indifferent', value: 'neutralFace' },
	{ name: 'Laughing', value: 'laugh' },
	{ name: 'Laughing to Tears', value: 'faceWithTearsOfJoy' },
	{ name: 'Like', value: 'like' },
	{ name: 'Love It', value: 'smilingFaceWithHearts' },
	{ name: 'No Comment', value: 'facepalm' },
	{ name: 'Not Sure', value: 'confusedFace' },
	{ name: 'OK', value: 'okHand' },
	{ name: 'Question', value: 'questionMark' },
	{ name: 'Rock', value: 'signHorns' },
	{ name: 'Sad', value: 'cry' },
	{ name: 'Shocked', value: 'wonder' },
	{ name: 'Sick', value: 'faceWithThermometer' },
	{ name: 'Sleeping', value: 'sleepingSymbol' },
	{ name: 'Smiling', value: 'slightlySmilingFace' },
	{ name: 'Smirking', value: 'smilingFaceWithHorns' },
	{ name: 'Strong', value: 'flexedBiceps' },
	{ name: 'Support', value: 'hundredPoints' },
	{ name: 'Teasing', value: 'faceWithStuckOutTongueAndWinkingEye' },
	{ name: 'Thank You', value: 'foldedHands' },
	{ name: 'Tongue Out', value: 'faceWithStuckOutTongue' },
	{ name: 'Winking', value: 'winkingFace' },
	{ name: 'Yuck', value: 'poo' },
	{ name: 'Zen', value: 'relievedFace' },
];

const reactionProperty = { displayName: 'Reaction', name: 'reaction', type: 'options' as const, default: 'like', options: REACTION_OPTIONS };

function succeeded(body: IDataObject): boolean {
	return (body.result as IDataObject | null)?.result === true;
}

export const messageResource: Resource = {
	value: 'message',
	name: 'Message',
	description: 'Messages the bot sends, and messages it reads in its chats',
	operations: [
		{
			value: 'send',
			name: 'Send',
			action: 'Send a message as the bot',
			description: 'Post a message from the bot into a chat or a private dialog, with an attachment, buttons, a quote or forwarded messages',
			properties: [botIdProperty, dialogIdProperty('Where to send'), ...messageOptionProperties('send')],
			async execute(itemIndex) {
				const botId = readBotId(this, itemIndex);
				const dialogId = readDialogId(this, itemIndex);
				const fields = messageFields(this, itemIndex, botId);
				const body = await botRequest.call(this, 'imbot.v2.Chat.Message.send', { botId, dialogId, fields }, itemIndex);
				const result = (body.result ?? {}) as IDataObject;
				// uuidMap arrives as [] when nothing was forwarded (a PHP empty array).
				const forwarded = result.uuidMap !== null && typeof result.uuidMap === 'object' && !Array.isArray(result.uuidMap) ? result.uuidMap : {};
				return { messageId: Number(result.id) || null, dialogId, forwarded };
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a message of the bot',
			description: 'Change the text, attachment or buttons of a message the bot sent; a system message cannot be changed',
			properties: [
				botIdProperty,
				messageIdProperty('ID of a message the bot sent'),
				{
					displayName: 'Update Fields',
					name: 'updateFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [
						{ displayName: 'Attachment (JSON)', name: 'attach', type: 'json', default: '{}', description: ATTACH_DESCRIPTION },
						{ displayName: 'Keyboard (JSON)', name: 'keyboard', type: 'json', default: '{}', description: KEYBOARD_DESCRIPTION },
						{ displayName: 'Link Preview', name: 'urlPreview', type: 'boolean', default: true, description: 'Whether links in the text turn into rich previews' },
						{ displayName: 'Remove Keyboard', name: 'removeKeyboard', type: 'boolean', default: true, description: 'Whether to take the buttons off the message' },
						{ displayName: 'Text', name: 'text', type: 'string', typeOptions: { rows: 4 }, default: '', description: 'The new text, up to 20 000 characters. It cannot be empty; use Delete to remove the message.' },
					],
				},
			],
			async execute(itemIndex) {
				const botId = readBotId(this, itemIndex);
				const messageId = readPositive(this, 'messageId', itemIndex, 'Message ID');
				const o = (this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject;
				const fields: IDataObject = {};
				if (o.text !== undefined) {
					if (String(o.text).trim() === '') throw new NodeOperationError(this.getNode(), 'Text cannot be empty', { itemIndex, description: 'Use Message → Delete to remove the message.' });
					fields.message = o.text as string;
				}
				const attach = optionalJson(this, o.attach, 'Attachment (JSON)', itemIndex);
				if (attach !== undefined) fields.attach = attach;
				if (o.removeKeyboard === true) fields.keyboard = 'N';
				else {
					const keyboard = keyboardFor(this, o.keyboard, botId, itemIndex);
					if (keyboard !== undefined) fields.keyboard = keyboard;
				}
				// The only field of this method documented as Y/N rather than a boolean.
				if (o.urlPreview !== undefined) fields.urlPreview = o.urlPreview === true ? 'Y' : 'N';
				if (Object.keys(fields).length === 0) throw new NodeOperationError(this.getNode(), 'Nothing to update: add at least one field', { itemIndex });
				const body = await botRequest.call(this, 'imbot.v2.Chat.Message.update', { botId, messageId, fields }, itemIndex);
				return { messageId, updated: succeeded(body) };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a message as the bot',
			description: 'Delete a message the bot sent, or any message of a chat the bot administers',
			properties: [
				botIdProperty,
				messageIdProperty(),
				{ displayName: 'Delete Completely', name: 'complete', type: 'boolean', default: false, description: 'Whether to erase the message from the database instead of leaving a "message deleted" mark' },
			],
			async execute(itemIndex) {
				const messageId = readPositive(this, 'messageId', itemIndex, 'Message ID');
				const complete = this.getNodeParameter('complete', itemIndex, false) === true;
				const body = await botRequest.call(this, 'imbot.v2.Chat.Message.delete', { botId: readBotId(this, itemIndex), messageId, complete }, itemIndex);
				return { messageId, deleted: succeeded(body) };
			},
		},
		{
			value: 'markRead',
			name: 'Mark as Read',
			action: 'Mark messages as read by the bot',
			description: 'Mark the messages of a conversation as read by the bot, all of them or up to a message, so the sender sees them read',
			properties: [botIdProperty, dialogIdProperty(), { displayName: 'Up to Message ID', name: 'upToMessageId', type: 'number', default: 0, description: 'The last message to mark, inclusive. 0 marks every message.' }],
			async execute(itemIndex) {
				const params: IDataObject = { botId: readBotId(this, itemIndex), dialogId: readDialogId(this, itemIndex) };
				const upTo = optionalInt(this.getNodeParameter('upToMessageId', itemIndex, 0));
				if (upTo !== undefined) params.messageId = upTo;
				const body = await botRequest.call(this, 'imbot.v2.Chat.Message.read', params, itemIndex);
				return { dialogId: params.dialogId, ...((body.result ?? {}) as IDataObject) };
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a message as the bot',
			description: 'Get one message with its author, e.g. the one a reply quotes. Only a supervisor or personal assistant bot may read.',
			properties: [botIdProperty, messageIdProperty()],
			async execute(itemIndex) {
				const messageId = readPositive(this, 'messageId', itemIndex, 'Message ID');
				const body = await botRequest.call(this, 'imbot.v2.Chat.Message.get', { botId: readBotId(this, itemIndex), messageId }, itemIndex);
				const result = (body.result ?? {}) as IDataObject;
				return { ...((result.message ?? {}) as IDataObject), author: result.user ?? null };
			},
		},
		{
			value: 'getContext',
			name: 'Get Context',
			action: 'Get the messages around a message',
			description: 'Get the messages before and after a message, oldest first, with authors, e.g. to give an AI the conversation. Only a supervisor or personal assistant bot may read.',
			properties: [
				botIdProperty,
				messageIdProperty('The message in the middle'),
				{ displayName: 'Messages on Each Side', name: 'range', type: 'number', typeOptions: { minValue: 1, maxValue: 50 }, default: 10, description: 'How many messages before and after it to return, 1 to 50' },
			],
			async execute(itemIndex) {
				const messageId = readPositive(this, 'messageId', itemIndex, 'Message ID');
				const range = Math.min(Math.max(Number(this.getNodeParameter('range', itemIndex, 10)) || 10, 1), 50);
				const body = await botRequest.call(this, 'imbot.v2.Chat.Message.getContext', { botId: readBotId(this, itemIndex), messageId, range }, itemIndex);
				const result = (body.result ?? {}) as IDataObject;
				return withAuthors(result.messages, result.users);
			},
		},
		{
			value: 'addReaction',
			name: 'Add Reaction',
			action: 'React to a message as the bot',
			description: 'Put a reaction of the bot on a message in a chat the bot is in',
			properties: [botIdProperty, messageIdProperty(), reactionProperty],
			async execute(itemIndex) {
				const messageId = readPositive(this, 'messageId', itemIndex, 'Message ID');
				const reaction = this.getNodeParameter('reaction', itemIndex) as string;
				const body = await botRequest.call(this, 'imbot.v2.Chat.Message.Reaction.add', { botId: readBotId(this, itemIndex), messageId, reaction }, itemIndex);
				return { messageId, reaction, added: succeeded(body) };
			},
		},
		{
			value: 'removeReaction',
			name: 'Remove Reaction',
			action: 'Take the bot\'s reaction off a message',
			description: 'Remove a reaction the bot put on a message',
			properties: [botIdProperty, messageIdProperty(), reactionProperty],
			async execute(itemIndex) {
				const messageId = readPositive(this, 'messageId', itemIndex, 'Message ID');
				const reaction = this.getNodeParameter('reaction', itemIndex) as string;
				const body = await botRequest.call(this, 'imbot.v2.Chat.Message.Reaction.delete', { botId: readBotId(this, itemIndex), messageId, reaction }, itemIndex);
				return { messageId, reaction, removed: succeeded(body) };
			},
		},
	],
};
