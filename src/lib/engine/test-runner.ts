import type {
  Model,
  ModelNode,
  NodeTestCase,
  IntegrationTestCase,
} from '@/lib/model'
import { createInput } from '@/lib/model'
import { createKieEngine, getKieBaseUrl } from '@/lib/engine'

export type IntegrationTestResult = {
  passed: boolean
  assertionResults: Record<string, TestResult> // nodeId → result
}

export type TestResult = {
  passed: boolean
  actual: string
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'NOT_EVALUATED'
  messages: string[]
}

/**
 * Build a mini model containing only the target node and its direct
 * dependencies converted to input nodes.
 */
export function buildTestModel(targetNodeId: string, model: Model): Model {
  const targetNode = model.nodes[targetNodeId]
  if (!targetNode) throw new Error(`Node "${targetNodeId}" not found`)

  const nodes: Record<string, ModelNode> = {}

  // Include dependencies: constants stay as-is, everything else becomes an input
  for (const depId of targetNode.dependencies) {
    const depNode = model.nodes[depId]
    if (!depNode) continue
    if (depNode.content.type === 'constant') {
      nodes[depId] = { ...depNode, dependencies: [], tests: undefined }
    } else {
      nodes[depId] = {
        id: depId,
        name: depNode.name,
        typeRef: depNode.typeRef,
        dependencies: [],
        content: createInput({ id: depId }),
      }
    }
  }

  // Add the target node itself (strip tests to keep the model lean)
  const { tests: _, ...targetWithoutTests } = targetNode
  nodes[targetNodeId] = targetWithoutTests

  return {
    id: model.id,
    name: model.name,
    namespace: model.namespace,
    nodes,
  }
}

/**
 * Execute a single test case against a node in isolation.
 */
export async function executeNodeTest(
  targetNodeId: string,
  testCase: NodeTestCase,
  model: Model,
  signal?: AbortSignal
): Promise<TestResult> {
  const miniModel = buildTestModel(targetNodeId, model)

  // Convert ID-keyed inputs to name-keyed inputs (KIE expects names)
  const nameInputs: Record<string, unknown> = {}
  for (const [depId, value] of Object.entries(testCase.inputs)) {
    const depNode = model.nodes[depId]
    if (depNode) {
      nameInputs[depNode.name] = value
    }
  }

  const engine = createKieEngine(getKieBaseUrl())
  const result = await engine.execute(miniModel, nameInputs, signal)

  const nodeResult = result.nodeResults[targetNodeId]
  if (!nodeResult) {
    return {
      passed: false,
      actual: '',
      status: 'NOT_EVALUATED',
      messages: ['No result returned for target node'],
    }
  }

  const actual =
    typeof nodeResult.result === 'object' && nodeResult.result !== null
      ? JSON.stringify(nodeResult.result)
      : String(nodeResult.result ?? '')

  const passed =
    actual === testCase.expected ||
    JSON.stringify(nodeResult.result) === testCase.expected

  return {
    passed,
    actual,
    status: nodeResult.status,
    messages: nodeResult.messages,
  }
}

/**
 * Execute an integration test against the full model.
 * One engine call per test — all assertions share the same execution result.
 */
export async function executeIntegrationTest(
  testCase: IntegrationTestCase,
  model: Model,
  signal?: AbortSignal
): Promise<IntegrationTestResult> {
  // Convert ID-keyed inputs to name-keyed inputs (KIE expects names)
  const nameInputs: Record<string, unknown> = {}
  for (const [nodeId, value] of Object.entries(testCase.inputs)) {
    const node = model.nodes[nodeId]
    if (node) {
      nameInputs[node.name] = value
    }
  }

  const engine = createKieEngine(getKieBaseUrl())
  const result = await engine.execute(model, nameInputs, signal)

  const assertionResults: Record<string, TestResult> = {}
  let allPassed = true

  for (const [nodeId, expected] of Object.entries(testCase.assertions)) {
    const nodeResult = result.nodeResults[nodeId]
    if (!nodeResult) {
      assertionResults[nodeId] = {
        passed: false,
        actual: '',
        status: 'NOT_EVALUATED',
        messages: ['No result returned for node'],
      }
      allPassed = false
      continue
    }

    const actual =
      typeof nodeResult.result === 'object' && nodeResult.result !== null
        ? JSON.stringify(nodeResult.result)
        : String(nodeResult.result ?? '')

    const passed =
      actual === expected || JSON.stringify(nodeResult.result) === expected

    if (!passed) allPassed = false

    assertionResults[nodeId] = {
      passed,
      actual,
      status: nodeResult.status,
      messages: nodeResult.messages,
    }
  }

  return { passed: allPassed, assertionResults }
}
