package org.rucca.cheese.auth.exception

class NoGuardOrNoAuthAnnotationException(controllerName: String, methodName: String) :
    RuntimeException(
        "Any method in a controller must have a @Guard or @NoAuth annotation. " +
            "However, method $methodName in controller $controllerName does not have any."
    )
