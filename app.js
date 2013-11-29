(function() {

	var clickCounter = 0,
		self = this,
		options = {
			limit: 1
		};

	$(function() {
		$('#ajaxCall').click(function(evt) {
			var clickNum = ++clickCounter;
			$('#numOfClicks').html(clickNum);
			ajaxCallSimulation(clickNum);
		});
		$('#turnSyncOn').click(function(evt) {
			AjaxSyncHelper.init(self);
			$(this).attr('disabled', "disabled");
			$('strong').html("ON").css('color', 'blue');
			_.each(options, function(value, key) {
				$('#syncOptions').show().append(key + ": " + value);
			});
			$('#acceptedClicks').append("<div>With AjaxSyncHelper activated:</div>");
		});
	});

	var ajaxCallSimulation = AjaxSyncHelper.ajaxCallerWrapper(function(clickNum) {
		$('#requestState').css('visibility', 'visible').html("Waiting for server for click number " + clickNum + "...");
		$('#acceptedClicks').append(clickNum + " ");
		_.delay(ajaxCallbackSimulation, 2000, clickNum);
	}, {limit: options.limit});

	var ajaxCallbackSimulation = AjaxSyncHelper.ajaxCallbackWrapper(function(clickNum) {
		$('#requestState').css('visibility', 'hidden');
		$('#responseState').html("Server responded for click number " + clickNum + "!");
	});

})();