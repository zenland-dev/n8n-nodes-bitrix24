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
import { loadOptions } from './methods';
import { dialogResource } from './resources/dialog';
import { lineResource } from './resources/line';
import { botDialogResource, crmChatResource, operatorResource } from './resources/operator';
import { statisticsResource } from './resources/statistics';

const resources: Resource[] = [dialogResource, operatorResource, crmChatResource, lineResource, statisticsResource, botDialogResource];

export class Bitrix24OpenLines implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 Open Lines',
		name: 'bitrix24OpenLines',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Handle client conversations in Bitrix24 open channels: operators, sessions, CRM chats, line settings and contact center statistics',
		defaults: { name: 'Bitrix24 Open Lines' },
		usableAsTool: true,
		builderHint: {
			searchHint:
				'Bitrix24 open channels (contact center): conversations with clients who write from a website chat, Telegram, WhatsApp and other connected channels. Each conversation is an open channel chat (Chat ID) with sessions inside it (Session ID). Find the chat of a CRM record with CRM Chat → Get Many or Get Latest Chat ID, of a client with Dialog → Get Chat by User Code. CRM Chat → Send Message writes to the client through their channel, from an employee or bot already in that chat. Operator → Take, Transfer, Finish act as the webhook user. Statistics → Get Summary and Get Sessions report on a period of at most 366 days and need access to open channel reports. Anything sent here reaches real clients.',
			relatedNodes: [
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Messenger',
					relationHint: 'Sends and reads messages in internal chats and private dialogs',
				},
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Crm',
					relationHint: 'Reads and changes the leads, deals, contacts and companies open channel chats are linked to',
				},
			],
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: WEBHOOK_CREDENTIAL, required: true }],
		properties: buildProperties(resources, 'dialog'),
	};

	methods = { loadOptions };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeResources.call(this, resources);
	}
}
