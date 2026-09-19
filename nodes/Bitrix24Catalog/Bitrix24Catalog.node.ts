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
import { catalogResource } from './resources/catalog';
import { productImageResource } from './resources/images';
import {
	documentCustomFieldResource,
	documentItemResource,
	documentResource,
	documentSupplierResource,
	stockResource,
	storeResource,
} from './resources/inventory';
import { itemResources } from './resources/items';
import {
	markupResource,
	priceResource,
	priceTypeAccessResource,
	priceTypeNameResource,
	priceTypeResource,
	roundingRuleResource,
} from './resources/prices';
import {
	propertyFeatureResource,
	propertyResource,
	propertySettingResource,
	propertyValueResource,
	sectionResource,
} from './resources/structure';
import { measureResource, unitRatioResource, vatRateResource } from './resources/units';

const resources: Resource[] = [
	...itemResources,
	productImageResource,
	priceResource,
	sectionResource,
	propertyResource,
	propertyValueResource,
	propertyFeatureResource,
	propertySettingResource,
	priceTypeResource,
	priceTypeAccessResource,
	priceTypeNameResource,
	markupResource,
	roundingRuleResource,
	measureResource,
	vatRateResource,
	unitRatioResource,
	storeResource,
	stockResource,
	documentResource,
	documentItemResource,
	documentSupplierResource,
	documentCustomFieldResource,
	catalogResource,
];

export class Bitrix24Catalog implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 Catalog',
		name: 'bitrix24Catalog',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Read and change the Bitrix24 product catalog: products, variations, services, prices, sections, properties, stores and inventory documents',
		defaults: { name: 'Bitrix24 Catalog' },
		usableAsTool: true,
		builderHint: {
			searchHint:
				'Bitrix24 product catalog — the products CRM deals and invoices sell. Product, Variation, Product With Variations and Service are four kinds of catalog item with the same operations; Product → Get Many returns all kinds (type 1 simple, 3 with variations, 7 service). Catalog can be left empty: the node takes the catalog the CRM uses, or the variations catalog tied to it. The selling price is not a product field: Price → Set Product Prices sets it per price type, Price → Get Many reads it with the filter {"productId": 101}. Property values go in as JSON keyed by property ID or code, e.g. {"COLOR": "Red"}; Property → Get Many lists IDs and codes. Stock is read with Stock → Get Many; with inventory management on it moves only through Inventory Document plus Document Item, then Conduct. To find a product by the ID an outside system gave it, filter Get Many by {"xmlId": "SKU-1"}.',
			relatedNodes: [
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Crm',
					relationHint: 'Puts catalog products into the product rows of deals, quotes and invoices',
				},
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Trigger',
					relationHint: 'Starts a workflow when a product, price or unit of measure changes, through an outgoing webhook',
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
		properties: buildProperties(resources, 'product'),
	};

	methods = { loadOptions };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeResources.call(this, resources);
	}
}
