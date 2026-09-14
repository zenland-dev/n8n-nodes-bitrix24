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
import { batchResource } from './resources/batch';
import { methodResource } from './resources/method';
import { portalResource } from './resources/portal';

const resources: Resource[] = [methodResource, batchResource, portalResource];

export class Bitrix24 implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24',
		name: 'bitrix24',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Call any Bitrix24 REST method, send batches of calls, and inspect what the webhook can reach',
		defaults: { name: 'Bitrix24' },
		usableAsTool: true,
		builderHint: {
			searchHint:
				'Universal access to the Bitrix24 REST API: the Method resource calls any method by name with a JSON body, so anything the module-specific Bitrix24 nodes lack is still one call away. Method names and parameters are those of apidocs.bitrix24.com, e.g. crm.item.list with {"entityTypeId": 2} for deals (1 lead, 3 contact, 4 company, 7 quote, 31 invoice, 1000+ smart processes). List methods return 50 rows per call; set Pagination to Page by ID to read everything cheaply. Batch sends up to 50 calls in one request, and Call for Each Item packs one call per input item 50 to a request — prefer it for bulk writes, because Bitrix24 allows only about 2 requests per second per portal. Portal tells which permissions the webhook has and which user it acts as; a method missing a permission answers insufficient_scope or ERROR_METHOD_NOT_FOUND.',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: WEBHOOK_CREDENTIAL, required: true }],
		properties: buildProperties(resources, 'method'),
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeResources.call(this, resources);
	}
}
