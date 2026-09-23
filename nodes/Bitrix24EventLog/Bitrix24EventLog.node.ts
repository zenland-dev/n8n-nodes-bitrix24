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
import { entryResource } from './resources/entry';
import { fieldResource } from './resources/field';

const resources: Resource[] = [entryResource, fieldResource];

export class Bitrix24EventLog implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 Event Log',
		name: 'bitrix24EventLog',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Read the Bitrix24 event log: sign-ins, password changes and other recorded actions',
		defaults: { name: 'Bitrix24 Event Log' },
		usableAsTool: true,
		builderHint: {
			searchHint:
				'The Bitrix24 event log — what the portal records about sign-ins, password changes and other system actions. Read-only: Bitrix24 has no method that writes an entry. Entry → Get Many takes a period in Filter and an event code such as USER_AUTHORIZE, and Entry → Get New walks forward from the ID the previous run stopped at, which is how a schedule polls the log without reading it twice. Only id, timestampX, auditTypeId, userId and guestId can be filtered or sorted; asking for any other field fails the whole call, and Field → Get Many is what says so. Every method needs a webhook made by an administrator with the main permission; a regular employee gets Access denied.',
			relatedNodes: [
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Employees',
					relationHint: 'Turns the userId of an entry into the person it belongs to',
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
		properties: buildProperties(resources, 'entry'),
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeResources.call(this, resources);
	}
}
