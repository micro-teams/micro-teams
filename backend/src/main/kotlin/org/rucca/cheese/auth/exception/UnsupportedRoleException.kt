package org.rucca.cheese.auth.exception

class UnsupportedRoleException(role: String) : RuntimeException("Unsupported role: $role")
