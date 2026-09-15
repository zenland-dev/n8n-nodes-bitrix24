import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import type { Resource } from '../../shared/spec';
import { buildProperties, executeResources } from '../../shared/spec';
import { CHATBOT_CREDENTIAL } from '../../shared/transport';
import { loadOptions } from './methods';
import { botResource } from './resources/bot';
import { chatMemberResource, chatResource } from './resources/chat';
import { commandResource } from './resources/command';
import { eventResource } from './resources/event';
import { fileResource } from './resources/file';
import { messageResource } from './resources/message';

const resources: Resource[] = [messageResource, chatResource, chatMemberResource, commandResource, fileResource, botResource, eventResource];

export class Bitrix24Chatbot implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 Chatbot',
		name: 'bitrix24Chatbot',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Register a Bitrix24 chatbot and answer as it: messages, buttons, slash commands, group chats and files',
		defaults: { name: 'Bitrix24 Chatbot' },
		usableAsTool: true,
		builderHint: {
			searchHint:
				'A Bitrix24 chatbot (Chatbots 2.0, imbot.v2) acting through an inbound webhook: its own name and avatar in the messenger, not the webhook user. The credential holds the webhook and a Bot Token; Bot → Register creates a bot tied to that token once, then every operation picks the bot. A conversation is a Dialog ID: chat123 for a group chat, or a user ID for the private chat of the bot with that user; events carry it as chat.dialogId. Message → Send takes BB-code text, Attachment JSON and Keyboard JSON; a keyboard button with COMMAND runs a slash command registered with Command → Register and arrives as a Command Called event, answered with Command → Answer. A plain bot gets private messages and @mentions only; Supervisor and Personal Assistant bots see every message of their chats and may use Message → Get and Get Context. Bitrix24 Chatbot Trigger polls the events. About 2 requests per second per portal.',
			relatedNodes: [
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24ChatbotTrigger',
					relationHint: 'Starts a workflow on messages to the bot, slash commands, button presses and reactions',
				},
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Messenger',
					relationHint: 'Sends and reads messages as the webhook user instead of a bot',
				},
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24',
					relationHint: 'Calls any Bitrix24 REST method this node lacks',
				},
			],
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: CHATBOT_CREDENTIAL, required: true }],
		properties: buildProperties(resources, 'message'),
	};

	methods = { loadOptions };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeResources.call(this, resources);
	}
}
