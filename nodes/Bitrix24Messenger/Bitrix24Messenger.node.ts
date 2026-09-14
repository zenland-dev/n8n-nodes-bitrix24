import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import type { Resource } from '../../shared/spec';
import { buildProperties, executeResources } from '../../shared/spec';
import { WEBHOOK_CREDENTIAL } from '../../shared/transport';
import { chatMemberResource, chatResource, recentResource } from './resources/chat';
import { eventQueueResource } from './resources/event';
import { fileResource } from './resources/file';
import { messageResource } from './resources/message';
import { notificationResource } from './resources/notification';
import { departmentResource, searchHistoryResource, userResource } from './resources/people';

const resources: Resource[] = [
	messageResource,
	chatResource,
	chatMemberResource,
	recentResource,
	fileResource,
	notificationResource,
	userResource,
	departmentResource,
	searchHistoryResource,
	eventQueueResource,
];

export class Bitrix24Messenger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 Messenger',
		name: 'bitrix24Messenger',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Send and read messages, manage chats, files and notifications in the Bitrix24 messenger',
		defaults: { name: 'Bitrix24 Messenger' },
		usableAsTool: true,
		builderHint: {
			searchHint:
				'Bitrix24 chats and private messages, sent and read as the user who owns the webhook. A conversation is addressed by Dialog ID: chat123 for group chat 123, sg12 for the chat of workgroup 12, or a plain user ID like 7 for the private chat with user 7. Message → Send posts text with BB codes ([B]bold[/B], [USER=7]name[/USER]) and optional ATTACH and KEYBOARD JSON; everyone in the chat gets notified. Message → Get Many reads only chats the webhook user is a member of. Notification → Send puts a notice into a user\'s bell instead of a chat. File → Upload takes binary data. Event Queue reads new messages without a public URL; the Bitrix24 Messenger Trigger polls it. About 2 requests per second per portal.',
			relatedNodes: [
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24MessengerTrigger',
					relationHint: 'Starts a workflow on new, edited or deleted messages in the chats of the webhook user',
				},
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24OpenLines',
					relationHint: 'Works with open channel dialogs with clients: operators, sessions, statistics',
				},
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24',
					relationHint: 'Calls any Bitrix24 REST method this node lacks',
				},
			],
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: WEBHOOK_CREDENTIAL, required: true }],
		properties: buildProperties(resources, 'message'),
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeResources.call(this, resources);
	}
}
