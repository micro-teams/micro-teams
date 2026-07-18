/*
 *  Description: This file implements the PageHelper class.
 *               It is responsible for paginating data.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

/*
 *
 * This file has exactly the same logic as the one in the legacy project.
 * See: https://github.com/SageSeekerSociety/microteams-backend/blob/dev/src/common/helper/page.helper.ts
 *
 */

package app.microteams.common.helper

import app.microteams.model.PageDTO
import kotlin.math.max
import kotlin.math.min
import org.rucca.cheese.common.persistent.IdType

object PageHelper {
    // Used when you do
    //
    // SELECT ... FROM ...
    //   WHERE ...
    //   AND id >= (firstId)
    // LIMIT (pageSize + 1)
    // ORDER BY id ASC
    //
    // in SQL.
    fun <TData> pageStart(
        data: List<TData>,
        pageSize: Int,
        idGetter: (TData) -> IdType,
    ): Pair<List<TData>, PageDTO> {
        return page(data, pageSize, false, null, idGetter)
    }

    // Used when you do both
    //
    // SELECT ... FROM ...
    //   WHERE ...
    //   AND id < (firstId)
    // LIMIT (pageSize)
    // ORDER BY id DESC
    //
    // and
    //
    // SELECT ... FROM ...
    //   WHERE ...
    //   AND id >= (firstId)
    // LIMIT (pageSize + 1)
    // ORDER BY id ASC
    //
    // in SQL.
    fun <TPrev, TData> pageMiddle(
        prev: List<TPrev>,
        data: List<TData>,
        pageSize: Int,
        idGetterPrev: (TPrev) -> IdType,
        idGetter: (TData) -> IdType,
    ): Pair<List<TData>, PageDTO> {
        return page(
            data,
            pageSize,
            prev.isNotEmpty(),
            if (prev.isNotEmpty()) idGetterPrev(prev.last()) else null,
            idGetter,
        )
    }

    // Used when you do
    //
    // SELECT ... FROM ...
    //   WHERE ...
    // LIMIT 1000
    // ORDER BY id ASC
    //
    // in SQL.
    fun <TData> pageFromAll(
        allData: List<TData>,
        pageStart: IdType?,
        pageSize: Int,
        idGetter: (TData) -> IdType,
        errorIfNotFound: ((IdType) -> Unit)?,
    ): Pair<List<TData>, PageDTO> {
        if (pageStart == null) {
            return pageStart(
                allData.subList(0, min(pageSize + 1, allData.size)),
                pageSize,
                idGetter,
            )
        } else {
            val pageStartIndex = allData.indexOfFirst { idGetter(it) == pageStart }
            if (pageStartIndex == -1) {
                if (errorIfNotFound == null) {
                    return pageStart(allData.subList(0, 0), pageSize, idGetter)
                } else {
                    errorIfNotFound(pageStart)
                }
            }
            val prev = allData.subList(max(pageStartIndex - pageSize, 0), pageStartIndex).reversed()
            val data =
                allData.subList(pageStartIndex, min(pageStartIndex + pageSize + 1, allData.size))
            return pageMiddle(prev, data, pageSize, idGetter, idGetter)
        }
    }

    private fun <TData> page(
        data: List<TData>,
        pageSize: Int,
        hasPrev: Boolean,
        prevStart: IdType?,
        idGetter: (TData) -> IdType,
    ): Pair<List<TData>, PageDTO> {
        if (data.isEmpty() || pageSize < 0) {
            return Pair(
                data,
                PageDTO(
                    pageStart = 0,
                    pageSize = 0,
                    hasPrev = hasPrev,
                    prevStart = prevStart,
                    hasMore = false,
                    nextStart = null,
                ),
            )
        } else if (data.size > pageSize) {
            return Pair(
                data.subList(0, pageSize),
                PageDTO(
                    pageStart = idGetter(data[0]),
                    pageSize = pageSize,
                    hasPrev = hasPrev,
                    prevStart = prevStart,
                    hasMore = true,
                    nextStart = idGetter(data[pageSize]),
                ),
            )
        } else {
            return Pair(
                data,
                PageDTO(
                    pageStart = idGetter(data[0]),
                    pageSize = data.size,
                    hasPrev = hasPrev,
                    prevStart = prevStart,
                    hasMore = false,
                    nextStart = null,
                ),
            )
        }
    }
}
