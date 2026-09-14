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
import { loadOptions, resourceMapping } from './methods';
import { activityResource } from './resources/activity';
import {
	automationResource,
	callListResource,
	deliveryResource,
	orderLinkResource,
	paymentResource,
	recurringDealResource,
	stageHistoryResource,
	trackingResource,
} from './resources/commerce';
import { documentNumeratorResource, documentResource, documentTemplateResource } from './resources/documents';
import { itemResource } from './resources/item';
import { productRowResource } from './resources/productRow';
import { duplicateResource, linkedCompanyResource, linkedContactResource } from './resources/relations';
import {
	addressResource,
	bankDetailResource,
	requisiteLinkResource,
	requisiteResource,
	requisiteTemplateFieldResource,
	requisiteTemplateResource,
} from './resources/requisites';
import {
	automatedSolutionResource,
	cardConfigurationResource,
	currencyResource,
	customFieldResource,
	dictionaryResource,
	pipelineResource,
	smartProcessTypeResource,
	statusResource,
	userFieldConfigResource,
} from './resources/settings';
import {
	timelineCommentResource,
	timelineEntryResource,
	timelineLogMessageResource,
	timelineNoteResource,
} from './resources/timeline';
import { ENTITY_TYPE } from './shared/entityTypes';

const resources: Resource[] = [
	itemResource({ value: 'lead', name: 'Lead', noun: 'lead', plural: 'leads', entityTypeId: ENTITY_TYPE.lead, description: 'Incoming requests not yet qualified' }),
	itemResource({ value: 'deal', name: 'Deal', noun: 'deal', plural: 'deals', entityTypeId: ENTITY_TYPE.deal, description: 'Sales moving through a pipeline' }),
	itemResource({ value: 'contact', name: 'Contact', noun: 'contact', plural: 'contacts', entityTypeId: ENTITY_TYPE.contact, description: 'People: clients and their representatives' }),
	itemResource({ value: 'company', name: 'Company', noun: 'company', plural: 'companies', entityTypeId: ENTITY_TYPE.company, description: 'Organisations clients belong to' }),
	itemResource({ value: 'quote', name: 'Quote', noun: 'quote', plural: 'quotes', entityTypeId: ENTITY_TYPE.quote, description: 'Commercial offers sent to clients' }),
	itemResource({ value: 'invoice', name: 'Invoice', noun: 'invoice', plural: 'invoices', entityTypeId: ENTITY_TYPE.invoice, description: 'Invoices (the new, smart-process based ones)' }),
	itemResource({ value: 'smartProcessItem', name: 'Smart Process Item', noun: 'smart process item', plural: 'smart process items', description: 'Items of any smart process — custom CRM object types' }),
	productRowResource,
	activityResource,
	timelineCommentResource,
	timelineNoteResource,
	timelineLogMessageResource,
	timelineEntryResource,
	linkedContactResource,
	linkedCompanyResource,
	duplicateResource,
	pipelineResource,
	statusResource,
	smartProcessTypeResource,
	customFieldResource,
	userFieldConfigResource,
	requisiteResource,
	bankDetailResource,
	addressResource,
	requisiteLinkResource,
	requisiteTemplateResource,
	requisiteTemplateFieldResource,
	documentResource,
	documentTemplateResource,
	documentNumeratorResource,
	paymentResource,
	deliveryResource,
	recurringDealResource,
	orderLinkResource,
	callListResource,
	stageHistoryResource,
	automationResource,
	trackingResource,
	currencyResource,
	automatedSolutionResource,
	cardConfigurationResource,
	dictionaryResource,
];

export class Bitrix24Crm implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 CRM',
		name: 'bitrix24Crm',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Work with leads, deals, contacts, companies, smart processes and everything around them in Bitrix24 CRM',
		defaults: { name: 'Bitrix24 CRM' },
		usableAsTool: true,
		builderHint: {
			searchHint:
				'Bitrix24 CRM through the universal crm.item API. A lead is an unqualified request; a deal is a sale in a pipeline; people are contacts, organisations are companies; smart processes are custom object types with IDs of 1000 and above. Field names are camelCase (title, stageId, assignedById, opportunity) and custom fields are ufCrm… — use Get Fields on a resource to learn the exact names, list values and required flags of this portal before writing. Stage IDs look like NEW or C3:WON (pipeline 3) and come from the Reference Book resource or the stage picker. Before creating a client, search with Duplicate → Find by Phone or Email. Create runs the portal automation rules like a person would; Import creates without them. Timeline Comment and Activity write into the history of a record; Product Row changes its products. Every call counts against about 2 requests per second per portal, so prefer Get Many with filters over many single Gets.',
			relatedNodes: [
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24',
					relationHint: 'Calls any Bitrix24 REST method this node lacks, or packs many calls into batches',
				},
			],
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: WEBHOOK_CREDENTIAL, required: true }],
		properties: buildProperties(resources, 'deal'),
	};

	methods = { loadOptions, resourceMapping };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeResources.call(this, resources);
	}
}
