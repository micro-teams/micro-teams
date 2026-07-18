package app.microteams.common.helper

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper

object RichTextHelper {
    private val objectMapper = ObjectMapper()

    fun toMarkdown(richText: String): String {
        val node = objectMapper.readTree(richText)
        return nodeToMarkdown(node)
    }

    private fun nodeToMarkdown(node: JsonNode): String {
        return when {
            node.has("type") -> {
                when (val type = node.get("type").asText()) {
                    "doc" ->
                        node.get("content")?.map { nodeToMarkdown(it) }?.joinToString("\n") ?: ""
                    "table" -> processTable(node)
                    "tableRow" ->
                        node.get("content")?.map { nodeToMarkdown(it) }?.joinToString(" | ") ?: ""
                    "tableCell" ->
                        node.get("content")?.map { nodeToMarkdown(it) }?.joinToString(" ") ?: ""
                    "paragraph" -> {
                        val content =
                            node.get("content")?.map { nodeToMarkdown(it) }?.joinToString("") ?: ""
                        "$content\n"
                    }
                    "text" -> {
                        var text = node.get("text").asText()
                        // 处理文本标记
                        if (node.has("marks")) {
                            node.get("marks").forEach { mark ->
                                when (mark.get("type").asText()) {
                                    "bold" -> text = "**$text**"
                                    "italic" -> text = "*$text*"
                                    "link" -> {
                                        val href = mark.get("attrs").get("href").asText()
                                        text = "[$text]($href)"
                                    }
                                }
                            }
                        }
                        text
                    }
                    else -> node.get("content")?.map { nodeToMarkdown(it) }?.joinToString(" ") ?: ""
                }
            }
            else -> ""
        }
    }

    private fun processTable(node: JsonNode): String {
        val rows =
            node.get("content")?.map { row ->
                row.get("content")?.map { cell -> nodeToMarkdown(cell).trim() }?.joinToString(" | ")
                    ?: ""
            } ?: return ""

        if (rows.isEmpty()) return ""

        // 计算列数
        val columnCount = rows[0].count { it == '|' } + 1
        // 创建分隔行
        val separator = List(columnCount) { "---" }.joinToString(" | ")

        return rows
            .mapIndexed { index, row ->
                if (index == 0) {
                    "$row\n$separator"
                } else {
                    row
                }
            }
            .joinToString("\n")
    }

    fun extractText(richText: String): String {
        val node = objectMapper.readTree(richText)
        return extractTextFromNode(node)
    }

    private fun extractTextFromNode(node: JsonNode): String {
        return when {
            node.has("text") -> node.get("text").asText()
            node.has("content") -> {
                node
                    .get("content")
                    .map { extractTextFromNode(it) }
                    .joinToString(" ")
                    .replace(Regex("\\s+"), " ")
                    .trim()
            }
            else -> ""
        }
    }

    fun extractTableContent(richText: String): Map<String, String> {
        val node = objectMapper.readTree(richText)
        if (!isTable(node)) return emptyMap()

        val result = mutableMapOf<String, String>()
        var currentKey = ""
        var currentValue = ""

        node.get("content").firstOrNull()?.get("content")?.forEach { row ->
            val cells = row.get("content")
            if (cells.size() == 2) {
                val key = extractTextFromNode(cells[0]).trim().removeSuffix("：").removeSuffix(":")
                val value = extractTextFromNode(cells[1]).trim()
                if (key.isNotEmpty() && value.isNotEmpty()) {
                    result[key] = value
                }
            }
        }

        return result
    }

    private fun isTable(node: JsonNode): Boolean {
        return node.has("type") &&
            node.get("type").asText() == "doc" &&
            node.has("content") &&
            node.get("content").firstOrNull()?.get("type")?.asText() == "table"
    }
}
