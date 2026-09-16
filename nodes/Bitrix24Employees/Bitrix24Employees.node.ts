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
import { departmentResource } from './resources/department';
import { employeeResource } from './resources/employee';
import { employeeFieldResource } from './resources/employeeField';
import { networkRangeResource } from './resources/networkRange';
import { timeReportResource } from './resources/timeReport';
import { workdayResource } from './resources/workday';

const resources: Resource[] = [
	employeeResource,
	employeeFieldResource,
	departmentResource,
	workdayResource,
	timeReportResource,
	networkRangeResource,
];

export class Bitrix24Employees implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 Employees',
		name: 'bitrix24Employees',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Find Bitrix24 employees, read the company structure and track working time',
		defaults: { name: 'Bitrix24 Employees' },
		usableAsTool: true,
		builderHint: {
			searchHint:
				'People on a Bitrix24 portal and what surrounds them. Employee → Get Many and Search turn an email, a name or a department into the numeric employee ID every other Bitrix24 node asks for; the filter is flat, so any employee field can be filtered on. Department covers the company structure: who heads what and what sits under what. Working Day opens, pauses and closes a shift and reads its status, which shows in the employee time report. Work Time Report reads a month of worked hours and the absences recorded in it. Inviting and updating employees needs a webhook made by an administrator, and inviting sends the person an email. The node does not cover the newer humanresources.* org structure.',
			relatedNodes: [
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Calendar',
					relationHint: 'Takes employee IDs as participants and calendar owners',
				},
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Tasks',
					relationHint: 'Takes employee IDs as the responsible person, creator and watchers',
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
		properties: buildProperties(resources, 'employee'),
	};

	methods = { loadOptions };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeResources.call(this, resources);
	}
}
