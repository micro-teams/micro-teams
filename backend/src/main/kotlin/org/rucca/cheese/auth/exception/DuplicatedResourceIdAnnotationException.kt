package org.rucca.cheese.auth.exception

class DuplicatedResourceIdAnnotationException(controllerName: String, methodName: String) :
    RuntimeException(
        "Only one parameter in a method can be annotated with @ResourceId. " +
            "However, method $methodName in controller $controllerName has more than one."
    )
