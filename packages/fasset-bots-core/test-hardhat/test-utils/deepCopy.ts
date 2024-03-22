export interface DeepCopyable {
    deepCopyThis(copiedObjectsMap: Map<any, any>): this;
}

type Constructor<T = any> = { new(...args: any[]): T; };

type DeepCopyFunction<T = any> = (object: T, copiedObjectsMap: Map<any, any>) => T;

type DeepCopyCondition<T = any> = (object: T) => boolean;

const deepCopyForClasses: Map<Constructor, DeepCopyFunction> = new Map();

const deepCopySpecialCases: Array<{ name: string, condition: DeepCopyCondition, copy: DeepCopyFunction }> = [];

function isInstance(cls: Constructor) {
    return (obj: any) => obj instanceof cls;
}

function isDeepCopyable(object: object): object is DeepCopyable {
    return typeof (object as any).deepCopyThis === 'function';
}

export function setDeepCopyForClass<C extends Constructor>(classConstructor: C, copy: DeepCopyFunction<InstanceType<C>>) {
    deepCopyForClasses.set(classConstructor, copy);
}

export function setDeepCopyForSubclasses<C extends Constructor>(classConstructor: C, copy: DeepCopyFunction<InstanceType<C>>) {
    setDeepCopyForCondition(classConstructor.name, isInstance(classConstructor), copy);
}

export function setDeepCopyForCondition<T>(name: string, condition: DeepCopyCondition<T>, copy: DeepCopyFunction<T>) {
    const index = deepCopySpecialCases.findIndex(sc => sc.name === name);
    if (index >= 0) return; // do not add twice
    deepCopySpecialCases.push({ name, condition, copy });
}

export function deepCopy<T>(object: T, copiedObjectsMap?: Map<any, any>): T {
    copiedObjectsMap ??= new Map();
    if (copiedObjectsMap.has(object)) {
        // reference to already (partially) copied object, just return the already made copy
        // this also solves cirular object problem
        return copiedObjectsMap.get(object);
    }
    if (typeof object === "object" && object != null) {
        // one of predefined special cases (based on condition)?
        const specialCase = deepCopySpecialCases.find(sc => sc.condition(object));
        if (specialCase != null) {
            return specialCase.copy(object, copiedObjectsMap);
        }
        // registered class?
        const deepCopy = deepCopyForClasses.get(object.constructor as Constructor);
        if (deepCopy != null) {
            return deepCopy(object, copiedObjectsMap);
        }
        // classes with static `deepCopyWithObjectCreate` get copied by deep creating same class object with deep copied properties
        if ((object.constructor as any).deepCopyWithObjectCreate) {
            // class object can be copied with deepCopyWithObjectCreate
            return deepCopyWithObjectCreate(object, copiedObjectsMap);
        }
        // classes with `deepCopyThis` method use that method for copying
        if (isDeepCopyable(object)) {
            // object has own `deepCopyThis` method
            return object.deepCopyThis(copiedObjectsMap);
        }
        // all other class object are not copied
        return object;
    } else {
        // atomic object (number, string, function, null, etc.) - return without copying
        return object;
    }
}

export function deepCopyWithObjectCreate<T extends object>(object: T, copiedObjectsMap: Map<any, any>): T {
    const res = Object.create(object.constructor.prototype, {
        constructor: { value: object.constructor, enumerable: false, writable: true, configurable: true },
    });
    copiedObjectsMap.set(object, res);
    for (const [key, value] of Object.entries(object)) {
        res[key] = deepCopy(value, copiedObjectsMap);
    }
    return res;
}

// register known classes

setDeepCopyForClass(Object, (object, copiedObjectsMap) => {
    const result: any = {};
    copiedObjectsMap.set(object, result);
    for (const [key, value] of Object.entries(object)) {
        result[key] = deepCopy(value, copiedObjectsMap);
    }
    return result;
});

setDeepCopyForClass(Array, (array, copiedObjectsMap) => {
    const result: any[] = [];
    copiedObjectsMap.set(array, result);
    // copy array items
    for (const elt of array as any[]) {
        result.push(deepCopy(elt, copiedObjectsMap));
    }
    // copy named properties
    for (const [key, value] of Object.entries(array)) {
        if (typeof key === 'string' && !/^\d+$/.test(key)) {
            (result as any)[key] = deepCopy(value, copiedObjectsMap);
        }
    }
    return result;
});

setDeepCopyForClass(Map, (map, copiedObjectsMap) => {
    const result: Map<any, any> = new Map();
    copiedObjectsMap.set(map, result);
    for (const [key, value] of map.entries()) {
        const keyCopy = deepCopy(key, copiedObjectsMap);
        const valueCopy = deepCopy(value, copiedObjectsMap);
        result.set(keyCopy, valueCopy);
    }
    return result;
});

setDeepCopyForClass(Set, (set, copiedObjectsMap) => {
    const result: Set<any> = new Set();
    copiedObjectsMap.set(set, result);
    for (const value of set.values()) {
        const valueCopy = deepCopy(value, copiedObjectsMap);
        result.add(valueCopy);
    }
    return result;
});
