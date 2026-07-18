/*
 *  Description: This file implements the CustomAuthLogics class.
 *               It is responsible for parsing and evaluating custom authorization logic expressions.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *      HuanCheng65
 *
 */

package org.rucca.cheese.auth

import org.parboiled.BaseParser
import org.parboiled.Parboiled.createParser
import org.parboiled.Rule
import org.parboiled.annotations.BuildParseTree
import org.parboiled.errors.ErrorUtils
import org.parboiled.parserunners.ReportingParseRunner
import org.rucca.cheese.common.persistent.IdGetter
import org.rucca.cheese.common.persistent.IdType
import org.slf4j.LoggerFactory

typealias CustomAuthLogicHandler =
    (
        userId: IdType,
        action: AuthorizedAction,
        resourceType: String,
        resourceId: IdType?,
        authInfo: Map<String, Any>,
        resourceOwnerIdGetter: IdGetter?,
        customLogicData: Any?,
    ) -> Boolean

class CustomAuthLogics {
    private val logics: MutableMap<String, CustomAuthLogicHandler> = mutableMapOf()
    private val parser = createParser(CustomAuthLogicsExpressionParser::class.java)
    private val logger = LoggerFactory.getLogger(CustomAuthLogics::class.java)

    fun register(name: String, handler: CustomAuthLogicHandler) {
        if (logics.containsKey(name))
            throw RuntimeException("Custom auth logic '$name' already exists.")
        logics[name] = handler
    }

    fun invoke(
        name: String,
        userId: IdType,
        action: AuthorizedAction,
        resourceType: String,
        resourceId: IdType?,
        authInfo: Map<String, Any>,
        resourceOwnerIdGetter: IdGetter?,
        customLogicData: Any?,
    ): Boolean {
        val handler = logics[name] ?: throw RuntimeException("Custom auth logic '$name' not found.")
        val result =
            handler(
                userId,
                action,
                resourceType,
                resourceId,
                authInfo,
                resourceOwnerIdGetter,
                customLogicData,
            )
        logger.debug(
            "Invoked custom auth logic '{}'. Result: {}, userId: {}, action: {}, resourceType: {}, resourceId: {}, authInfo: {}, resourceOwnerIdGetter: {}, customLogicData: {}",
            name,
            result,
            userId,
            action,
            resourceType,
            resourceId,
            authInfo,
            resourceOwnerIdGetter,
            customLogicData,
        )
        return result
    }

    fun evaluate(
        expression: String,
        userId: IdType,
        action: AuthorizedAction,
        resourceType: String,
        resourceId: IdType?,
        authInfo: Map<String, Any>,
        resourceOwnerIdGetter: IdGetter?,
        customLogicData: Any?,
    ): Boolean {
        val root: CustomAuthLogicsExpressionNode
        synchronized(parser) {
            val parserRunner =
                ReportingParseRunner<CustomAuthLogicsExpressionNode>(parser.Expression())
            val result = parserRunner.run(expression)
            if (result.hasErrors()) {
                throw RuntimeException(
                    "Failed to parse custom auth logic expression: '$expression'. Details: ${ErrorUtils.printParseErrors(result.parseErrors)}"
                )
            }
            root = result.parseTreeRoot.getValue()
        }
        if (root !is CustomAuthLogicsVariableNode)
            logger.debug(
                "Parsed complex custom auth logic expression. Original: '{}', parsed: {}",
                expression,
                root,
            )
        fun evaluator(node: CustomAuthLogicsExpressionNode): Boolean {
            return when (node) {
                is CustomAuthLogicsAndNode -> evaluator(node.left) && evaluator(node.right)
                is CustomAuthLogicsOrNode -> evaluator(node.left) || evaluator(node.right)
                is CustomAuthLogicsNotNode -> !evaluator(node.child)
                is CustomAuthLogicsVariableNode ->
                    invoke(
                        node.name,
                        userId,
                        action,
                        resourceType,
                        resourceId,
                        authInfo,
                        resourceOwnerIdGetter,
                        customLogicData,
                    )
            }
        }
        return evaluator(root)
    }
}

sealed class CustomAuthLogicsExpressionNode

class CustomAuthLogicsAndNode(
    val left: CustomAuthLogicsExpressionNode,
    val right: CustomAuthLogicsExpressionNode,
) : CustomAuthLogicsExpressionNode() {
    override fun toString(): String {
        return "($left && $right)"
    }
}

class CustomAuthLogicsOrNode(
    val left: CustomAuthLogicsExpressionNode,
    val right: CustomAuthLogicsExpressionNode,
) : CustomAuthLogicsExpressionNode() {
    override fun toString(): String {
        return "($left || $right)"
    }
}

class CustomAuthLogicsNotNode(val child: CustomAuthLogicsExpressionNode) :
    CustomAuthLogicsExpressionNode() {
    override fun toString(): String {
        return "(!$child)"
    }
}

class CustomAuthLogicsVariableNode(val name: String) : CustomAuthLogicsExpressionNode() {
    override fun toString(): String {
        return name
    }
}

@BuildParseTree
open class CustomAuthLogicsExpressionParser : BaseParser<CustomAuthLogicsExpressionNode>() {
    open fun Expression(): Rule {
        return FirstOf(
            Sequence(
                Term(),
                ZeroOrMore(
                    FirstOf(
                        Sequence(
                            AndOperator(),
                            Term(),
                            push(
                                CustomAuthLogicsAndNode(
                                    pop(1) as CustomAuthLogicsExpressionNode,
                                    pop() as CustomAuthLogicsExpressionNode,
                                )
                            ),
                        ),
                        Sequence(
                            OrOperator(),
                            Term(),
                            push(
                                CustomAuthLogicsOrNode(
                                    pop(1) as CustomAuthLogicsExpressionNode,
                                    pop() as CustomAuthLogicsExpressionNode,
                                )
                            ),
                        ),
                    )
                ),
            ),
            NotExpression(),
        )
    }

    open fun Term(): Rule {
        return FirstOf(Variable(), Parens(), NotExpression())
    }

    open fun Parens(): Rule {
        return Sequence('(', WhiteSpace(), Expression(), WhiteSpace(), ')')
    }

    open fun Variable(): Rule {
        return Sequence(
            Sequence(
                FirstOf(CharRange('a', 'z'), CharRange('A', 'Z'), AnyOf("-_")),
                OneOrMore(
                    FirstOf(
                        CharRange('a', 'z'),
                        CharRange('A', 'Z'),
                        CharRange('0', '9'),
                        AnyOf("-_"),
                    )
                ),
            ),
            push(CustomAuthLogicsVariableNode(match())),
        )
    }

    open fun AndOperator(): Rule {
        return Sequence(WhiteSpace(), "&&", WhiteSpace())
    }

    open fun OrOperator(): Rule {
        return Sequence(WhiteSpace(), "||", WhiteSpace())
    }

    open fun NotExpression(): Rule {
        return Sequence(
            Ch('!'),
            WhiteSpace(),
            Term(),
            push(CustomAuthLogicsNotNode(pop() as CustomAuthLogicsExpressionNode)),
        )
    }

    open fun WhiteSpace(): Rule {
        return ZeroOrMore(AnyOf(" \t\r\n"))
    }
}
