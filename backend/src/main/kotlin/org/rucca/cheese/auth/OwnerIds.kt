/*
 *  Description: This file implements the OwnerIds class.
 *               It is responsible for managing owner ID providers.
 *
 *  Author(s):
 *      Nictheboy Li    <nictheboy@outlook.com>
 *
 */

package org.rucca.cheese.auth

import org.rucca.cheese.common.persistent.IdGetter
import org.rucca.cheese.common.persistent.IdType

typealias OwnerIdProvider = (resourceId: IdType) -> IdType

class OwnerIds {
    private val ownerIdProviders: MutableMap<String, OwnerIdProvider> = mutableMapOf()

    fun register(resourceType: String, ownerIdProvider: OwnerIdProvider) {
        if (ownerIdProviders.containsKey(resourceType)) {
            throw RuntimeException(
                "Owner ID provider for resource type $resourceType is already registered."
            )
        }
        ownerIdProviders[resourceType] = ownerIdProvider
    }

    fun getOwnerIdGetter(resourceType: String, resourceId: IdType): IdGetter? {
        val handler = ownerIdProviders[resourceType] ?: return null
        return object : IdGetter {
            var cache: IdType? = null

            override fun invoke(): IdType {
                if (cache == null) {
                    cache = handler(resourceId)
                }
                return cache!!
            }
        }
    }
}
