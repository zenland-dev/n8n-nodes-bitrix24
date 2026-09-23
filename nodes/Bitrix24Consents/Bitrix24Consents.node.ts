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
import { agreementResource } from './resources/agreement';
import { consentResource } from './resources/consent';

const resources: Resource[] = [agreementResource, consentResource];

export class Bitrix24Consents implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 Consents',
		name: 'bitrix24Consents',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Read Bitrix24 agreements and record the consents people give to them',
		defaults: { name: 'Bitrix24 Consents' },
		usableAsTool: true,
		builderHint: {
			searchHint:
				'Bitrix24 agreements and the consents given to them — the record a portal keeps when someone agrees to their data being processed or to a newsletter. Three steps in one node: Agreement → Get Many finds the agreement by name and says whether it is switched on, Agreement → Get Text returns the wording to show, and Consent → Create stores the answer against the agreement ID and the address it came from. The form itself is yours: Bitrix24 hands out the text and keeps the record, it does not display anything. Agreements are written and edited in the Bitrix24 interface, not through the API, so there is no Create or Update here. The webhook needs the userconsent permission.',
			relatedNodes: [
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Crm',
					relationHint: 'Finds or creates the contact or lead the consent belongs to',
				},
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Employees',
					relationHint: 'Turns a person into the user ID a consent can be filed under',
				},
			],
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: WEBHOOK_CREDENTIAL, required: true }],
		properties: buildProperties(resources, 'agreement'),
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeResources.call(this, resources);
	}
}
