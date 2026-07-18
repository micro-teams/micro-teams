/*
 *  Description: This file defines the ApproveType enum class.
 *               It is a generic enum class for approval status of something.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package app.microteams.common.persistent

import app.microteams.model.ApproveTypeDTO

/*
 *
 *  Do not delete any row of this enum,
 *  because it is stored in database as an integer.
 *
 *  If you want to add a new row, add it to the end of the enum.
 *  This will prevent changing the values of the existing rows.
 *
 */

enum class ApproveType {
    APPROVED,
    DISAPPROVED,
    NONE,
}

fun ApproveType.convert(): ApproveTypeDTO {
    return when (this) {
        ApproveType.APPROVED -> ApproveTypeDTO.APPROVED
        ApproveType.DISAPPROVED -> ApproveTypeDTO.DISAPPROVED
        ApproveType.NONE -> ApproveTypeDTO.NONE
    }
}

fun ApproveTypeDTO.convert(): ApproveType {
    return when (this) {
        ApproveTypeDTO.APPROVED -> ApproveType.APPROVED
        ApproveTypeDTO.DISAPPROVED -> ApproveType.DISAPPROVED
        ApproveTypeDTO.NONE -> ApproveType.NONE
    }
}
