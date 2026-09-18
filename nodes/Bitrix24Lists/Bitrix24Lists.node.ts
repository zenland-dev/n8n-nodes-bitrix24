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
import { elementResource } from './resources/element';
import { fieldResource } from './resources/field';
import { listResource } from './resources/list';
import { sectionResource } from './resources/section';

const resources: Resource[] = [elementResource, listResource, fieldResource, sectionResource];

export class Bitrix24Lists implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 Lists',
		name: 'bitrix24Lists',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Read and change Bitrix24 universal lists: their elements, fields and sections',
		defaults: { name: 'Bitrix24 Lists' },
		usableAsTool: true,
		builderHint: {
			searchHint:
				'Bitrix24 universal lists — the tables a portal keeps next to the CRM: requests, contracts, registries. Every operation names the list twice: List Type (universal lists, group lists or feed processes) and then the list itself by List ID or List Code. Element → Get Many reads the rows, filtered by field code with {"=PROPERTY_951": 1269}; Create and Update take the values as JSON by the same codes, and a multiple field wants an array even for one value. Field → Get Many is what gives those codes, so a workflow that writes elements usually reads the fields first. Section covers the folders elements sit in, List creates and deletes whole lists. Elements of a list with business processes switched on can start one through the Bitrix24 Business Processes node.',
			relatedNodes: [
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24BizProc',
					relationHint: 'Starts a business process on a list element and reads the tasks it creates',
				},
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Crm',
					relationHint: 'Reads the CRM records a list element links to through a CRM binding field',
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
		properties: buildProperties(resources, 'element'),
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeResources.call(this, resources);
	}
}
