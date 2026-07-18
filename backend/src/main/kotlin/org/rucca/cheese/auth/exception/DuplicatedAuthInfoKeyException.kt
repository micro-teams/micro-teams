package org.rucca.cheese.auth.exception

class DuplicatedAuthInfoKeyException(
    controllerName: String,
    methodName: String,
    duplicatedKey: String,
) :
    RuntimeException(
        "Duplicated AuthInfo annotation key '$duplicatedKey' in $controllerName.$methodName"
    )
