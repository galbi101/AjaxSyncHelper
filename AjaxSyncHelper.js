define(
    [
        'underscore',
        'backbone',
        'src/modules/common/components/util/HelperBase'
    ],
    function(_, Backbone, HelperBase) {

        // private functions:

        var funcCounter = 0;

        function getCallOrig(func) {
            return function(context) {
                func.apply(context, Array.prototype.slice.call(arguments, 1));
            };
        }

        function makeWrapper(wrapperFunc, origFunc, options /* for future enhancements */) {
            wrapperFunc.callOrig = origFunc.callOrig || getCallOrig(origFunc);
            wrapperFunc._origFunc = origFunc._origFunc || origFunc;
            wrapperFunc.cid = "func" + funcCounter++;
            return wrapperFunc;
        }

        function makeCallInQueueWrapper(inQueueFunc, origFunc, options) {
            var wrapper = function() {
                if (this.syncHelper) {
                    this.syncHelper.callNextFuncInQueue({func: wrapper, params: arguments});
                }
                else {
                    origFunc.apply(this, arguments);
                }
            };
            wrapper._inQueue = inQueueFunc || origFunc;
            if (options) {
                _.has(options, 'limit') && options.limit > 0 && (wrapper._limit = options.limit);
                _.has(options, 'prioritizeNew') && (wrapper._prioritizeNew = options.prioritizeNew);
                _.has(options, 'block') && (wrapper._block = options.block);
            }
            return makeWrapper(wrapper, origFunc, options);
        }

        function resetSemaphore(queue) {
            if (!queue) return;
            queue.semaphore = {
                locker: null,
                blocked: null,
                pending: []
            }
        }

        // public static functions:

        function ajaxCallerWrapper(func, options) {
            var wrapper = makeCallInQueueWrapper(function() {
                if (this.syncHelper) {
                    this.syncHelper.trigger("ajaxStart");
                    this.syncHelper._applyLock(true, wrapper);
                }
                func.apply(this, arguments);
            }, func, options);
            if (options) {
                _.has(options, 'unlockers') && (wrapper._unlockers = options.unlockers);
            }
            return wrapper;
        }

        function ajaxCallbackWrapper(func, options) {
            var wrapper = makeWrapper(function() {
                func.apply(this, arguments);
                if (this.syncHelper) {
                    this.syncHelper._applyLock(false, wrapper);
                    this.syncHelper.trigger("ajaxComplete");
                    this.syncHelper.callNextFuncInQueue();
                }
            }, func, options);
            return wrapper;
        }

        function ajaxQueueBreakerWrapper(func, options) {
            return makeWrapper(function() {
                if (this.syncHelper) {
                    this.syncHelper._applyLock("break");
                }
                func.apply(this, arguments);
            }, func, options);
        }

        function nonAjaxWrapper(func, options) {
            var wrapper = makeCallInQueueWrapper(function() {
                if (this.syncHelper) {
                    this.syncHelper._applyLock(true, wrapper);
                }
                func.apply(this, arguments);
                if (this.syncHelper) {
                    this.syncHelper._applyLock(false, wrapper);
                    this.syncHelper.callNextFuncInQueue();
                }
            }, func, options);
            return wrapper;
        }

        // functions to be added to the using module upon 'init':

        var _resetFuncQueue = function() {
            this.syncHelper._funcQueue = [];
            resetSemaphore(this.syncHelper._funcQueue);
        };

        var _applyLock = function(locked, callingFunc) {
            if (!_.isBoolean(locked)) {
                if (locked === "break") {
                    this.syncHelper._resetFuncQueue();
                    this.syncHelper.trigger("queueBreak");
                }
                return;
            }
            if (locked) {
                if (!this.syncHelper._funcQueue.semaphore.locker) {
                    if (callingFunc) {
                        this.syncHelper._funcQueue.semaphore.locker = callingFunc.cid;
                        this.syncHelper._funcQueue.semaphore.blocked = callingFunc._block;
                        this.syncHelper._funcQueue.semaphore.pending = _.compact(_.map(callingFunc._unlockers, function(funcName) {
                            return this[funcName] && this[funcName].cid;
                        }, this));
                    }
                    else {
                        this.syncHelper._funcQueue.semaphore.locker = true;
                    }
                }
            }
            else {
                var locker, pending;
                if (locker = this.syncHelper._funcQueue.semaphore.locker) {
                    // locker is cid of the locking func
                    if (_.isString(locker) && !_.isEmpty(pending = this.syncHelper._funcQueue.semaphore.pending)) {
                        if (callingFunc && callingFunc.cid) {
                            var indexOfUnlocker = _.indexOf(pending, callingFunc.cid);
                            if (~indexOfUnlocker) {
                                pending.splice(indexOfUnlocker, 1);
                                if (_.isEmpty(pending)) {
                                    resetSemaphore(this.syncHelper._funcQueue);
                                }
                            }
                        }
                    }
                    // anonymous locker or no specific unlockers required
                    else {
                        resetSemaphore(this.syncHelper._funcQueue);
                    }
                }
            }
        };

        var addToQueue = function(funcToAdd) {
            if (!funcToAdd || this.syncHelper._funcQueue.semaphore.blocked) return;
            if (_.isArray(funcToAdd)) {
                _.each(funcToAdd, function(singleFuncToAdd) {
                    this.syncHelper.addToQueue(singleFuncToAdd);
                }, this);
            }
            else {
                var func = this.syncHelper._getFuncFromDetails(funcToAdd);
                if (!func) return;
                if (func._limit) {
                    var firstIndexOfFunc = -1, count = 0;
                    _.each(this.syncHelper._funcQueue, function(funcInQ, i) {
                        funcInQ = this.syncHelper._getFuncFromDetails(funcInQ);
                        if (funcInQ && funcInQ.cid == func.cid) {
                            !~firstIndexOfFunc && (firstIndexOfFunc = i);
                            ++count;
                        }
                    }, this);
                    if (this.syncHelper._funcQueue.semaphore.locker === func.cid) {
                        ++count;
                    }
                    if (count < func._limit) {
                        this.syncHelper._funcQueue.push(funcToAdd);
                    }
                    else if (func._prioritizeNew && ~firstIndexOfFunc) {
                        this.syncHelper._funcQueue.splice(firstIndexOfFunc, 1);
                        this.syncHelper.addToQueue(funcToAdd);
                    }
                }
                else {
                    this.syncHelper._funcQueue.push(funcToAdd);
                }
            }
        };

        var callNextFuncInQueue = function(funcToAdd) {
            funcToAdd && this.syncHelper.addToQueue(funcToAdd);
            if (!this.syncHelper._funcQueue.semaphore.locker) {
                var funcDetails = this.syncHelper._funcQueue.shift();
                if (funcDetails) {
                    this.syncHelper._runFunc(funcDetails);
                }
                else {
                    this.syncHelper.trigger("queueEnd");
                }
            }
        };

        var _getFuncFromDetails = function(funcDetails) {
            if (!funcDetails) return;
            var func;
            if (funcDetails.func) {
                func = funcDetails.func;
            }
            else if (funcDetails.name) {
                var context = funcDetails.context || this;
                func = context[funcDetails.name] || this[funcDetails.name];
            }
            return func;
        };

        var _runFunc = function(funcDetails) {
            if (!funcDetails) return;
            var context = funcDetails.context || this;
            var func = this.syncHelper._getFuncFromDetails(funcDetails);
            func && (func._inQueue || func).apply(context, funcDetails.params);
        };

        var AjaxSyncHelper = _.extend({

            init: function(context) {
                if (!context) return;
                context.syncHelper = _.extend({
                    _resetFuncQueue: _.bind(_resetFuncQueue, context),
                    _applyLock: _.bind(_applyLock, context),
                    addToQueue: _.bind(addToQueue, context),
                    callNextFuncInQueue: _.bind(callNextFuncInQueue, context),
                    _getFuncFromDetails: _.bind(_getFuncFromDetails, context),
                    _runFunc: _.bind(_runFunc, context)
                }, Backbone.Events);
                context.syncHelper._resetFuncQueue();
            },

            ajaxCallerWrapper: ajaxCallerWrapper,
            ajaxCallbackWrapper: ajaxCallbackWrapper,
            ajaxQueueBreakerWrapper: ajaxQueueBreakerWrapper,
            nonAjaxWrapper: nonAjaxWrapper

        }, HelperBase);

        return AjaxSyncHelper;

    }
);