import { GraphQLError } from '../../error/GraphQLError.js';

import type {
  FragmentDefinitionNode,
  FragmentSpreadNode,
  InlineFragmentNode,
  OperationDefinitionNode,
  OperationTypeNode,
  SelectionSetNode,
} from '../../language/ast.js';
import { Kind } from '../../language/kinds.js';
import type { ASTVisitor } from '../../language/visitor.js';

import {
  GraphQLDeferDirective,
  GraphQLStreamDirective,
} from '../../type/directives.js';
import type { GraphQLObjectType } from '../../type/index.js';

import type { ValidationContext } from '../ValidationContext.js';

/**
 * Defer and stream directives are used on valid root field
 *
 * A GraphQL document is only valid if defer directives are not used on root mutation or subscription types.
 */
export function DeferStreamDirectiveOnRootFieldRule(
  context: ValidationContext,
): ASTVisitor {
  return {
    OperationDefinition(node: OperationDefinitionNode) {
      const document = context.getDocument();
      const fragments = new Map<string, FragmentDefinitionNode>();

      for (const definition of document.definitions) {
        if (definition.kind === Kind.FRAGMENT_DEFINITION) {
          fragments.set(definition.name.value, definition);
        }
      }
      if (node.operation !== 'subscription' && node.operation !== 'mutation') {
        return;
      }
      const schema = context.getSchema();
      const rootType = schema.getRootType(node.operation);
      if (rootType) {
        forbidDeferStream({
          context,
          operationType: node.operation,
          rootType,
          fragments,
          selectionSet: node.selectionSet,
          visitedFragments: new Set(),
        });
      }
    },
  };
}

function forbidDeferStream({
  context,
  operationType,
  rootType,
  fragments,
  selectionSet,
  visitedFragments,
}: {
  context: ValidationContext;
  operationType: OperationTypeNode;
  rootType: GraphQLObjectType;
  fragments: Map<string, FragmentDefinitionNode>;
  selectionSet: SelectionSetNode;
  visitedFragments: Set<string>;
}) {
  for (const selection of selectionSet.selections) {
    if (selection.kind === 'Field') {
      const stream = selection.directives?.find(
        (d) => d.name.value === GraphQLStreamDirective.name,
      );
      if (stream) {
        context.reportError(
          new GraphQLError(
            `Stream directive cannot be used on root ${operationType} type "${rootType}".`,
            { nodes: stream },
          ),
        );
      }
    } else if (selection.kind === 'FragmentSpread') {
      const fragmentName = selection.name.value;
      if (visitedFragments.has(fragmentName)) {
        continue;
      }
      const fragment = fragments.get(fragmentName);
      if (fragment) {
        const defer = getDeferDirective(selection);
        if (defer) {
          context.reportError(
            new GraphQLError(
              `Defer directive cannot be used on root ${operationType} type "${rootType}".`,
              { nodes: defer },
            ),
          );
        }
        forbidDeferStream({
          context,
          operationType,
          rootType,
          fragments,
          selectionSet: fragment.selectionSet,
          visitedFragments,
        });
      }
      visitedFragments.add(fragmentName);
    } else if (selection.kind === 'InlineFragment') {
      const defer = getDeferDirective(selection);
      if (defer) {
        context.reportError(
          new GraphQLError(
            `Defer directive cannot be used on root ${operationType} type "${rootType}".`,
            { nodes: defer },
          ),
        );
      }
      forbidDeferStream({
        context,
        operationType,
        rootType,
        fragments,
        selectionSet: selection.selectionSet,
        visitedFragments,
      });
    }
  }
}

function getDeferDirective(fragment: FragmentSpreadNode | InlineFragmentNode) {
  return fragment.directives?.find(
    (d) => d.name.value === GraphQLDeferDirective.name,
  );
}
