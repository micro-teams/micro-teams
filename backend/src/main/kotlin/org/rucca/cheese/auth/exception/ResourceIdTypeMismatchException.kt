package org.rucca.cheese.auth.exception

class ResourceIdTypeMismatchException(controllerName: String, methodName: String) :
    RuntimeException(
        "Resource ID type mismatch in controller $controllerName method $methodName. " +
            "Resource ID must be of type IdType."
    )
